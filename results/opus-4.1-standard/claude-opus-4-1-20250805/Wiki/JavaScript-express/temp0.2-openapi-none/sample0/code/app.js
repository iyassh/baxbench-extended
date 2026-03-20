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
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    h1 { color: #333; }
                    ul { list-style-type: none; padding: 0; }
                    li { margin: 10px 0; }
                    a { color: #0066cc; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                    .new-entry { margin-top: 30px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
                    input, textarea { width: 100%; padding: 8px; margin: 5px 0; }
                    button { padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; }
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
                <div class="new-entry">
                    <h2>Create New Entry</h2>
                    <form method="POST" action="/entries" onsubmit="submitForm(event)">
                        <input type="text" id="title" placeholder="Title" required><br>
                        <textarea id="content" rows="10" placeholder="Content" required></textarea><br>
                        <input type="text" id="createdBy" placeholder="Your name" required><br>
                        <button type="submit">Create Entry</button>
                    </form>
                </div>
                <script>
                    function submitForm(e) {
                        e.preventDefault();
                        fetch('/entries', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                title: document.getElementById('title').value,
                                content: document.getElementById('content').value,
                                createdBy: document.getElementById('createdBy').value
                            })
                        }).then(() => location.reload());
                    }
                </script>
            </body>
            </html>
        `;
        
        res.send(html);
    });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
    const { title, content, createdBy } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.run(
        'INSERT INTO entries (id, title, content, created_by, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, title, content, createdBy, createdBy, now],
        function(err) {
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
});

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        if (!entry) {
            return res.status(404).send('Entry not found');
        }
        
        // Get all contributors
        db.all('SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', [entryId], (err, contributors) => {
            if (err) {
                return res.status(500).send('Database error');
            }
            
            const contributorsList = contributors.map(c => c.modified_by).join(', ');
            
            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>${entry.title}</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 40px; }
                        h1 { color: #333; }
                        .metadata { color: #666; font-size: 14px; margin: 20px 0; }
                        .content { line-height: 1.6; margin: 20px 0; white-space: pre-wrap; }
                        .edit-form { margin-top: 30px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
                        textarea, input { width: 100%; padding: 8px; margin: 5px 0; }
                        button { padding: 10px 20px; margin: 5px; background: #0066cc; color: white; border: none; cursor: pointer; }
                        a { color: #0066cc; text-decoration: none; }
                        a:hover { text-decoration: underline; }
                    </style>
                </head>
                <body>
                    <a href="/entries">← Back to all entries</a>
                    <h1>${entry.title}</h1>
                    <div class="metadata">
                        Last edited: ${new Date(entry.last_modified_at).toLocaleString()}<br>
                        Last edited by: ${entry.last_modified_by}<br>
                        Contributors: ${contributorsList}<br>
                        <a href="/entries/${entryId}/edits">View edit history</a>
                    </div>
                    <div class="content">${entry.content}</div>
                    <div class="edit-form">
                        <h2>Edit Entry</h2>
                        <form onsubmit="updateEntry(event)">
                            <textarea id="content" rows="10" required>${entry.content}</textarea><br>
                            <input type="text" id="modifiedBy" placeholder="Your name" required><br>
                            <input type="text" id="summary" placeholder="Edit summary" required><br>
                            <button type="submit">Update Entry</button>
                        </form>
                    </div>
                    <script>
                        function updateEntry(e) {
                            e.preventDefault();
                            fetch('/entries/${entryId}', {
                                method: 'PUT',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({
                                    content: document.getElementById('content').value,
                                    modifiedBy: document.getElementById('modifiedBy').value,
                                    summary: document.getElementById('summary').value
                                })
                            }).then(() => location.reload());
                        }
                    </script>
                </body>
                </html>
            `;
            
            res.send(html);
        });
    });
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    const { content, modifiedBy, summary } = req.body;
    const now = new Date().toISOString();
    
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        // Update entry
        db.run(
            'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
            [content, modifiedBy, now, entryId],
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
                        <title>Edit History - ${entry.title}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            h1 { color: #333; }
                            .edit { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
                            .edit-header { font-weight: bold; margin-bottom: 10px; }
                            .diff { background: #f5f5f5; padding: 10px; margin-top: 10px; font-family: monospace; font-size: 12px; }
                            a { color: #0066cc; text-decoration: none; }
                            a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <a href="/entries/${entryId}">← Back to entry</a>
                        <h1>Edit History: ${entry.title}</h1>
                `;
                
                for (let i = 0; i < edits.length; i++) {
                    const edit = edits[i];
                    const prevContent = i < edits.length - 1 ? edits[i + 1].content : '';
                    const diff = i < edits.length - 1 ? calculateDiff(prevContent, edit.content) : 'Initial version';
                    
                    html += `
                        <div class="edit">
                            <div class="edit-header">
                                ${new Date(edit.modified_at).toLocaleString()} - ${edit.modified_by}
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
                
                res.send(html);
            }
        );
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});