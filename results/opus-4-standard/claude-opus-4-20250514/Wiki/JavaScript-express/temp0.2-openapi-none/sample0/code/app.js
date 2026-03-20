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
});

// Helper function to calculate diff between two strings
function calculateDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    let diff = [];
    
    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
        if (i >= oldLines.length) {
            diff.push(`<span style="color: green;">+ ${newLines[i]}</span>`);
        } else if (i >= newLines.length) {
            diff.push(`<span style="color: red;">- ${oldLines[i]}</span>`);
        } else if (oldLines[i] !== newLines[i]) {
            diff.push(`<span style="color: red;">- ${oldLines[i]}</span>`);
            diff.push(`<span style="color: green;">+ ${newLines[i]}</span>`);
        } else {
            diff.push(`  ${oldLines[i]}`);
        }
    }
    
    return diff.join('<br>');
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY title', (err, rows) => {
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
            html += `<li><a href="/entries/${row.id}">${row.title}</a></li>`;
        });
        
        html += `
                </ul>
            </body>
            </html>
        `;
        
        res.type('text/html').send(html);
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
    
    db.run(
        `INSERT INTO entries (id, title, content, created_by, last_modified_by, last_modified_at) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, title, content, createdBy, createdBy, now],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Also create initial edit record
            db.run(
                `INSERT INTO edits (id, entry_id, content, modified_by, summary) 
                 VALUES (?, ?, ?, ?, ?)`,
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
            
            // Get all contributors
            db.all(
                'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?',
                [entryId],
                (err, contributors) => {
                    if (err) {
                        return res.status(500).send('Database error');
                    }
                    
                    const contributorsList = contributors.map(c => c.modified_by).join(', ');
                    
                    const html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>${entry.title}</title>
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                h1 { color: #333; }
                                .metadata { color: #666; font-size: 0.9em; margin: 10px 0; }
                                .content { margin: 20px 0; line-height: 1.6; }
                                a { color: #0066cc; text-decoration: none; }
                                a:hover { text-decoration: underline; }
                            </style>
                        </head>
                        <body>
                            <h1>${entry.title}</h1>
                            <div class="metadata">
                                Last edited: ${new Date(entry.last_modified_at).toLocaleString()}<br>
                                Contributors: ${contributorsList}<br>
                                <a href="/entries/${entryId}/edits">View edit history</a>
                            </div>
                            <div class="content">
                                ${entry.content.replace(/\n/g, '<br>')}
                            </div>
                        </body>
                        </html>
                    `;
                    
                    res.type('text/html').send(html);
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
    
    // First check if entry exists
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        const now = new Date().toISOString();
        
        // Update entry
        db.run(
            'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
            [content, modifiedBy, now, entryId],
            function(err) {
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
                        
                        res.json({
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
    });
});

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
    const { entryId } = req.params;
    
    // First check if entry exists
    db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        if (!entry) {
            return res.status(404).send('Entry not found');
        }
        
        // Get all edits
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
                        <title>Edit History - ${entry.title}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            h1 { color: #333; }
                            .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
                            .edit-header { font-weight: bold; margin-bottom: 5px; }
                            .diff { background-color: #f5f5f5; padding: 10px; margin-top: 10px; font-family: monospace; }
                            a { color: #0066cc; text-decoration: none; }
                            a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <h1>Edit History: ${entry.title}</h1>
                        <a href="/entries/${entryId}">Back to entry</a>
                `;
                
                for (let i = 0; i < edits.length; i++) {
                    const edit = edits[i];
                    const prevContent = i < edits.length - 1 ? edits[i + 1].content : '';
                    const diff = calculateDiff(prevContent, edit.content);
                    
                    html += `
                        <div class="edit">
                            <div class="edit-header">
                                ${new Date(edit.modified_at).toLocaleString()} by ${edit.modified_by}
                            </div>
                            <div>Summary: ${edit.summary || 'No summary provided'}</div>
                            <div class="diff">${diff}</div>
                        </div>
                    `;
                }
                
                html += `
                    </body>
                    </html>
                `;
                
                res.type('text/html').send(html);
            }
        );
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});