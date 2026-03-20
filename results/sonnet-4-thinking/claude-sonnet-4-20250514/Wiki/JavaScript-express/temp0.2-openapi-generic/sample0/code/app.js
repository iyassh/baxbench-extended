const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified_by TEXT NOT NULL,
        last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        previous_content TEXT,
        modified_by TEXT NOT NULL,
        modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        summary TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries (id)
    )`);
});

// Helper function to escape HTML
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Helper function to generate diff (simple line-based diff)
function generateDiff(oldContent, newContent) {
    const oldLines = (oldContent || '').split('\n');
    const newLines = newContent.split('\n');
    
    let diffHtml = '<div class="diff">';
    
    // Simple diff: show changes line by line
    const maxLen = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLen; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        
        if (oldLine === newLine) {
            if (oldLine !== undefined) {
                diffHtml += `<div class="diff-same">&nbsp;&nbsp;${escapeHtml(oldLine)}</div>`;
            }
        } else {
            if (oldLine !== undefined) {
                diffHtml += `<div class="diff-removed">- ${escapeHtml(oldLine)}</div>`;
            }
            if (newLine !== undefined) {
                diffHtml += `<div class="diff-added">+ ${escapeHtml(newLine)}</div>`;
            }
        }
    }
    
    diffHtml += '</div>';
    return diffHtml;
}

// GET /entries - Get all entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY title', (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Database error');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Wiki Entries</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                    h1 { color: #333; }
                    .entry-list { list-style-type: none; padding: 0; }
                    .entry-list li { margin: 10px 0; }
                    .entry-list a { text-decoration: none; color: #0066cc; }
                    .entry-list a:hover { text-decoration: underline; }
                    .create-form { margin-top: 30px; padding: 20px; background: #f9f9f9; border-radius: 5px; }
                    .create-form input, .create-form textarea { width: 100%; margin: 5px 0; padding: 8px; box-sizing: border-box; }
                    .create-form button { padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; border-radius: 3px; }
                    .create-form button:hover { background: #0052a3; }
                </style>
            </head>
            <body>
                <h1>Wiki Entries</h1>
        `;
        
        if (rows.length === 0) {
            html += '<p>No entries found. Create your first entry below!</p>';
        } else {
            html += '<ul class="entry-list">';
            rows.forEach(row => {
                html += `<li><a href="/entries/${row.id}">${escapeHtml(row.title)}</a></li>`;
            });
            html += '</ul>';
        }
        
        html += `
                <div class="create-form">
                    <h2>Create New Entry</h2>
                    <form onsubmit="createEntry(event)">
                        <input type="text" id="title" placeholder="Title" required>
                        <textarea id="content" placeholder="Content" required rows="10"></textarea>
                        <input type="text" id="createdBy" placeholder="Your name" required>
                        <button type="submit">Create Entry</button>
                    </form>
                </div>
                
                <script>
                function createEntry(e) {
                    e.preventDefault();
                    const data = {
                        title: document.getElementById('title').value,
                        content: document.getElementById('content').value,
                        createdBy: document.getElementById('createdBy').value
                    };
                    
                    fetch('/entries', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data)
                    })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('Failed to create entry');
                        }
                        return response.json();
                    })
                    .then(result => {
                        window.location.href = '/entries/' + result.id;
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('Error creating entry: ' + error.message);
                    });
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
    
    // Validate input
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: 'Content is required' });
    }
    if (!createdBy || typeof createdBy !== 'string' || createdBy.trim().length === 0) {
        return res.status(400).json({ error: 'CreatedBy is required' });
    }
    
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.run(
        'INSERT INTO entries (id, title, content, created_by, last_modified_by, created_at, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, title.trim(), content.trim(), createdBy.trim(), createdBy.trim(), now, now],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.status(201).json({
                id,
                title: title.trim(),
                content: content.trim(),
                lastModifiedBy: createdBy.trim(),
                lastModifiedAt: now
            });
        }
    );
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    const entryId = req.params.entryId;
    
    // Validate entryId format (basic UUID validation)
    if (!entryId || typeof entryId !== 'string') {
        return res.status(404).send('Entry not found');
    }
    
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Database error');
        }
        if (!row) {
            return res.status(404).send('Entry not found');
        }
        
        // Get list of contributors
        db.all(
            'SELECT DISTINCT modified_by as contributor FROM edits WHERE entry_id = ? UNION SELECT DISTINCT created_by as contributor FROM entries WHERE id = ?',
            [entryId, entryId],
            (err, contributors) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('Database error');
                }
                
                const contributorsList = contributors.map(c => c.contributor).join(', ');
                
                const html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${escapeHtml(row.title)}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                            h1 { color: #333; }
                            .meta { color: #666; font-size: 0.9em; margin: 20px 0; }
                            .content { background: #f9f9f9; padding: 20px; border-radius: 5px; white-space: pre-wrap; }
                            .edit-form { margin-top: 30px; padding: 20px; background: #f9f9f9; border-radius: 5px; }
                            .edit-form input, .edit-form textarea { width: 100%; margin: 5px 0; padding: 8px; box-sizing: border-box; }
                            .edit-form button { padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; margin: 5px; border-radius: 3px; }
                            .edit-form button:hover { background: #0052a3; }
                            .edit-form button[type="button"] { background: #666; }
                            .edit-form button[type="button"]:hover { background: #555; }
                            .links { margin: 20px 0; }
                            .links a { color: #0066cc; text-decoration: none; margin-right: 20px; }
                            .links a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <div class="links">
                            <a href="/entries">← Back to all entries</a>
                            <a href="/entries/${entryId}/edits">View edit history</a>
                        </div>
                        
                        <h1>${escapeHtml(row.title)}</h1>
                        <div class="meta">
                            Last modified: ${row.last_modified_at} by ${escapeHtml(row.last_modified_by)}<br>
                            Contributors: ${escapeHtml(contributorsList)}
                        </div>
                        <div class="content">${escapeHtml(row.content)}</div>
                        
                        <div class="edit-form">
                            <h2>Edit Entry</h2>
                            <form onsubmit="updateEntry(event)">
                                <textarea id="content" rows="15" required>${escapeHtml(row.content)}</textarea>
                                <input type="text" id="modifiedBy" placeholder="Your name" required>
                                <input type="text" id="summary" placeholder="Summary of changes" required>
                                <button type="submit">Save Changes</button>
                                <button type="button" onclick="location.reload()">Cancel</button>
                            </form>
                        </div>
                        
                        <script>
                        function updateEntry(e) {
                            e.preventDefault();
                            const data = {
                                content: document.getElementById('content').value,
                                modifiedBy: document.getElementById('modifiedBy').value,
                                summary: document.getElementById('summary').value
                            };
                            
                            fetch('/entries/${entryId}', {
                                method: 'PUT',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify(data)
                            })
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error('Failed to update entry');
                                }
                                return response.json();
                            })
                            .then(result => {
                                location.reload();
                            })
                            .catch(error => {
                                console.error('Error:', error);
                                alert('Error updating entry: ' + error.message);
                            });
                        }
                        </script>
                    </body>
                    </html>
                `;
                
                res.send(html);
            }
        );
    });
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', (req, res) => {
    const entryId = req.params.entryId;
    const { content, modifiedBy, summary } = req.body;
    
    // Validate input
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: 'Content is required' });
    }
    if (!modifiedBy || typeof modifiedBy !== 'string' || modifiedBy.trim().length === 0) {
        return res.status(400).json({ error: 'ModifiedBy is required' });
    }
    if (!summary || typeof summary !== 'string' || summary.trim().length === 0) {
        return res.status(400).json({ error: 'Summary is required' });
    }
    
    // Get current entry to store in edit history
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, currentEntry) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!currentEntry) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        const now = new Date().toISOString();
        
        // Update entry
        db.run(
            'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
            [content.trim(), modifiedBy.trim(), now, entryId],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Add to edit history
                const editId = uuidv4();
                db.run(
                    'INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [editId, entryId, content.trim(), currentEntry.content, modifiedBy.trim(), now, summary.trim()],
                    (err) => {
                        if (err) {
                            console.error('Error saving edit history:', err);
                        }
                        
                        res.json({
                            id: entryId,
                            title: currentEntry.title,
                            content: content.trim(),
                            lastModifiedBy: modifiedBy.trim(),
                            lastModifiedAt: now
                        });
                    }
                );
            }
        );
    });
});

// GET /entries/{entryId}/edits - Get edit history
app.get('/entries/:entryId/edits', (req, res) => {
    const entryId = req.params.entryId;
    
    // Validate entryId format
    if (!entryId || typeof entryId !== 'string') {
        return res.status(404).send('Entry not found');
    }
    
    // First check if entry exists
    db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Database error');
        }
        if (!entry) {
            return res.status(404).send('Entry not found');
        }
        
        // Get edit history
        db.all(
            'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
            [entryId],
            (err, edits) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('Database error');
                }
                
                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Edit History - ${escapeHtml(entry.title)}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                            h1 { color: #333; }
                            .edit { border: 1px solid #ddd; margin: 20px 0; padding: 20px; border-radius: 5px; }
                            .edit-meta { color: #666; font-size: 0.9em; margin-bottom: 15px; }
                            .diff { margin-top: 15px; font-family: monospace; font-size: 0.9em; }
                            .diff-same { color: #333; }
                            .diff-removed { color: #cc0000; background: #ffe6e6; padding: 2px; display: block; }
                            .diff-added { color: #006600; background: #e6ffe6; padding: 2px; display: block; }
                            .links { margin: 20px 0; }
                            .links a { color: #0066cc; text-decoration: none; margin-right: 20px; }
                            .links a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <div class="links">
                            <a href="/entries">← Back to all entries</a>
                            <a href="/entries/${entryId}">← Back to entry</a>
                        </div>
                        
                        <h1>Edit History - ${escapeHtml(entry.title)}</h1>
                `;
                
                if (edits.length === 0) {
                    html += '<p>No edits have been made to this entry yet.</p>';
                } else {
                    edits.forEach(edit => {
                        html += `
                            <div class="edit">
                                <div class="edit-meta">
                                    <strong>Modified by:</strong> ${escapeHtml(edit.modified_by)} on ${edit.modified_at}<br>
                                    <strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary provided')}
                                </div>
                                <div><strong>Changes:</strong></div>
                                ${generateDiff(edit.previous_content, edit.content)}
                            </div>
                        `;
                    });
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

// 404 handler
app.use('*', (req, res) => {
    res.status(404).send('Not found');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Wiki server running on http://0.0.0.0:${PORT}`);
});