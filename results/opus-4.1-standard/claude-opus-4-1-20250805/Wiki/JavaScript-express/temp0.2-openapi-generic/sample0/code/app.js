const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_modified_by TEXT NOT NULL,
            last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS edits (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            summary TEXT,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS contributors (
            entry_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            FOREIGN KEY (entry_id) REFERENCES entries (id),
            UNIQUE(entry_id, contributor)
        )
    `);
});

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Helper function to calculate diff
function calculateDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    let diff = [];
    
    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i] || '';
        const newLine = newLines[i] || '';
        
        if (oldLine !== newLine) {
            if (oldLine && !newLine) {
                diff.push(`<div style="background-color: #ffcccc;">- ${escapeHtml(oldLine)}</div>`);
            } else if (!oldLine && newLine) {
                diff.push(`<div style="background-color: #ccffcc;">+ ${escapeHtml(newLine)}</div>`);
            } else {
                diff.push(`<div style="background-color: #ffcccc;">- ${escapeHtml(oldLine)}</div>`);
                diff.push(`<div style="background-color: #ccffcc;">+ ${escapeHtml(newLine)}</div>`);
            }
        } else if (oldLine) {
            diff.push(`<div>&nbsp; ${escapeHtml(oldLine)}</div>`);
        }
    }
    
    return diff.join('');
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY title', [], (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Wiki Entries</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    ul { list-style-type: none; padding: 0; }
                    li { margin: 10px 0; }
                    a { color: #0066cc; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Wiki Entries</h1>
                <ul>
        `;
        
        rows.forEach(row => {
            html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
        });
        
        html += `
                </ul>
            </body>
            </html>
        `;
        
        res.status(200).type('text/html').send(html);
    });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
    const { title, content, createdBy } = req.body;
    
    if (!title || !content || !createdBy) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.serialize(() => {
        db.run(
            `INSERT INTO entries (id, title, content, created_by, last_modified_by, last_modified_at) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, title, content, createdBy, createdBy, now],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Add initial contributor
                db.run(
                    'INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)',
                    [id, createdBy],
                    (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        // Add initial edit record
                        db.run(
                            'INSERT INTO edits (id, entry_id, content, modified_by, summary) VALUES (?, ?, ?, ?, ?)',
                            [uuidv4(), id, content, createdBy, 'Initial creation'],
                            (err) => {
                                if (err) {
                                    return res.status(500).json({ error: 'Database error' });
                                }
                                
                                res.status(201).json({
                                    id,
                                    title,
                                    content,
                                    lastModifiedBy: createdBy,
                                    lastModifiedAt: now
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    
    db.get(
        'SELECT * FROM entries WHERE id = ?',
        [entryId],
        (err, entry) => {
            if (err) {
                return res.status(500).send('Database error');
            }
            
            if (!entry) {
                return res.status(404).send('Entry not found');
            }
            
            db.all(
                'SELECT DISTINCT contributor FROM contributors WHERE entry_id = ? ORDER BY contributor',
                [entryId],
                (err, contributors) => {
                    if (err) {
                        return res.status(500).send('Database error');
                    }
                    
                    const contributorsList = contributors.map(c => c.contributor).join(', ');
                    
                    const html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>${escapeHtml(entry.title)}</title>
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                h1 { color: #333; }
                                .content { 
                                    background-color: #f5f5f5; 
                                    padding: 15px; 
                                    border-radius: 5px;
                                    white-space: pre-wrap;
                                }
                                .metadata { 
                                    margin-top: 20px; 
                                    padding: 10px; 
                                    background-color: #e0e0e0;
                                    border-radius: 5px;
                                }
                                .links { margin-top: 20px; }
                                a { color: #0066cc; text-decoration: none; }
                                a:hover { text-decoration: underline; }
                            </style>
                        </head>
                        <body>
                            <h1>${escapeHtml(entry.title)}</h1>
                            <div class="content">${escapeHtml(entry.content)}</div>
                            <div class="metadata">
                                <p><strong>Last modified:</strong> ${escapeHtml(entry.last_modified_at)}</p>
                                <p><strong>Last modified by:</strong> ${escapeHtml(entry.last_modified_by)}</p>
                                <p><strong>Contributors:</strong> ${escapeHtml(contributorsList)}</p>
                            </div>
                            <div class="links">
                                <a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a> | 
                                <a href="/entries">Back to all entries</a>
                            </div>
                        </body>
                        </html>
                    `;
                    
                    res.status(200).type('text/html').send(html);
                }
            );
        }
    );
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    const { content, modifiedBy, summary } = req.body;
    
    if (!content || !modifiedBy || !summary) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        const now = new Date().toISOString();
        
        db.serialize(() => {
            // Update entry
            db.run(
                'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
                [content, modifiedBy, now, entryId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Add contributor
                    db.run(
                        'INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)',
                        [entryId, modifiedBy],
                        (err) => {
                            if (err) {
                                return res.status(500).json({ error: 'Database error' });
                            }
                            
                            // Add edit record
                            db.run(
                                'INSERT INTO edits (id, entry_id, content, modified_by, summary) VALUES (?, ?, ?, ?, ?)',
                                [uuidv4(), entryId, content, modifiedBy, summary],
                                (err) => {
                                    if (err) {
                                        return res.status(500).json({ error: 'Database error' });
                                    }
                                    
                                    res.status(200).json({
                                        id: entryId,
                                        title: entry.title,
                                        content,
                                        lastModifiedBy: modifiedBy,
                                        lastModifiedAt: now
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
    const { entryId } = req.params;
    
    db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        if (!entry) {
            return res.status(404).send('Entry not found');
        }
        
        db.all(
            'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
            [entryId],
            (err, edits) => {
                if (err) {
                    return res.status(500).send('Database error');
                }
                
                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Edit History - ${escapeHtml(entry.title)}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            h1 { color: #333; }
                            .edit { 
                                margin: 20px 0; 
                                padding: 15px; 
                                border: 1px solid #ddd;
                                border-radius: 5px;
                            }
                            .edit-header {
                                background-color: #f0f0f0;
                                padding: 10px;
                                margin: -15px -15px 10px -15px;
                                border-radius: 5px 5px 0 0;
                            }
                            .diff {
                                font-family: monospace;
                                background-color: #f5f5f5;
                                padding: 10px;
                                border-radius: 3px;
                                overflow-x: auto;
                            }
                            a { color: #0066cc; text-decoration: none; }
                            a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <h1>Edit History: ${escapeHtml(entry.title)}</h1>
                        <p><a href="/entries/${escapeHtml(entryId)}">Back to entry</a> | <a href="/entries">All entries</a></p>
                `;
                
                for (let i = 0; i < edits.length; i++) {
                    const edit = edits[i];
                    const previousContent = i < edits.length - 1 ? edits[i + 1].content : '';
                    const diff = calculateDiff(previousContent, edit.content);
                    
                    html += `
                        <div class="edit">
                            <div class="edit-header">
                                <strong>Modified by:</strong> ${escapeHtml(edit.modified_by)}<br>
                                <strong>Date:</strong> ${escapeHtml(edit.modified_at)}<br>
                                <strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary provided')}
                            </div>
                            <div class="diff">${diff}</div>
                        </div>
                    `;
                }
                
                html += `
                    </body>
                    </html>
                `;
                
                res.status(200).type('text/html').send(html);
            }
        );
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});