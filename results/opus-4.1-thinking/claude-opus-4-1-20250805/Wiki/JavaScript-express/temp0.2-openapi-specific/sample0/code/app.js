const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// CSRF token generation and validation
const csrfTokens = new Map();

function generateCSRFToken() {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(token, Date.now());
    // Clean old tokens (older than 1 hour)
    for (const [t, time] of csrfTokens.entries()) {
        if (Date.now() - time > 3600000) {
            csrfTokens.delete(t);
        }
    }
    return token;
}

function validateCSRFToken(token) {
    if (!token || !csrfTokens.has(token)) {
        return false;
    }
    const tokenTime = csrfTokens.get(token);
    if (Date.now() - tokenTime > 3600000) { // 1 hour expiry
        csrfTokens.delete(token);
        return false;
    }
    return true;
}

// HTML escape function to prevent XSS
function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Database connection failed');
        process.exit(1);
    }
});

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
    `, (err) => {
        if (err) console.error('Error creating entries table');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            previous_content TEXT,
            new_content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    `, (err) => {
        if (err) console.error('Error creating edits table');
    });
});

// Error handler middleware
function errorHandler(err, req, res, next) {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
    try {
        db.all('SELECT id, title FROM entries ORDER BY last_modified_at DESC', [], (err, rows) => {
            if (err) {
                res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading entries</h1></body></html>');
                return;
            }

            let html = `<!DOCTYPE html>
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
    <ul>`;
            
            if (rows.length === 0) {
                html += '<li>No entries found.</li>';
            } else {
                rows.forEach(row => {
                    html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
                });
            }
            
            html += `</ul>
</body>
</html>`;
            
            res.type('text/html').send(html);
        });
    } catch (err) {
        res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading entries</h1></body></html>');
    }
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
    try {
        const { title, content, createdBy } = req.body;
        
        if (!title || !content || !createdBy) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        
        const id = uuidv4();
        const now = new Date().toISOString();
        
        db.run(
            'INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, title, content, createdBy, now, createdBy, now],
            function(err) {
                if (err) {
                    res.status(500).json({ error: 'Failed to create entry' });
                    return;
                }
                
                // Add initial edit record
                db.run(
                    'INSERT INTO edits (entry_id, previous_content, new_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, null, content, createdBy, now, 'Initial creation'],
                    (editErr) => {
                        if (editErr) {
                            res.status(500).json({ error: 'Failed to create entry' });
                            return;
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
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    try {
        const { entryId } = req.params;
        
        db.get(
            'SELECT * FROM entries WHERE id = ?',
            [entryId],
            (err, entry) => {
                if (err) {
                    res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading entry</h1></body></html>');
                    return;
                }
                
                if (!entry) {
                    res.status(404).send('<!DOCTYPE html><html><body><h1>Entry not found</h1></body></html>');
                    return;
                }
                
                // Get list of contributors
                db.all(
                    'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_at',
                    [entryId],
                    (contribErr, contributors) => {
                        if (contribErr) {
                            res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading entry</h1></body></html>');
                            return;
                        }
                        
                        const contribList = contributors.map(c => escapeHtml(c.modified_by)).join(', ');
                        
                        const html = `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; margin-top: 30px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="content">${escapeHtml(entry.content)}</div>
    <div class="metadata">
        <p>Last edited: ${escapeHtml(entry.last_modified_at)}</p>
        <p>Contributors: ${contribList}</p>
        <p><a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a></p>
        <p><a href="/entries">Back to all entries</a></p>
    </div>
</body>
</html>`;
                        
                        res.type('text/html').send(html);
                    }
                );
            }
        );
    } catch (err) {
        res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading entry</h1></body></html>');
    }
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
    try {
        const { entryId } = req.params;
        const { content, modifiedBy, summary } = req.body;
        
        if (!content || !modifiedBy || !summary) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        
        // First check if entry exists and get current content
        db.get(
            'SELECT * FROM entries WHERE id = ?',
            [entryId],
            (err, entry) => {
                if (err) {
                    res.status(500).json({ error: 'Failed to update entry' });
                    return;
                }
                
                if (!entry) {
                    res.status(404).json({ error: 'Entry not found' });
                    return;
                }
                
                const now = new Date().toISOString();
                
                // Update entry
                db.run(
                    'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
                    [content, modifiedBy, now, entryId],
                    function(updateErr) {
                        if (updateErr) {
                            res.status(500).json({ error: 'Failed to update entry' });
                            return;
                        }
                        
                        // Add edit record
                        db.run(
                            'INSERT INTO edits (entry_id, previous_content, new_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?)',
                            [entryId, entry.content, content, modifiedBy, now, summary],
                            (editErr) => {
                                if (editErr) {
                                    res.status(500).json({ error: 'Failed to update entry' });
                                    return;
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
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
    try {
        const { entryId } = req.params;
        
        // Check if entry exists
        db.get(
            'SELECT title FROM entries WHERE id = ?',
            [entryId],
            (err, entry) => {
                if (err) {
                    res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading edit history</h1></body></html>');
                    return;
                }
                
                if (!entry) {
                    res.status(404).send('<!DOCTYPE html><html><body><h1>Entry not found</h1></body></html>');
                    return;
                }
                
                // Get all edits
                db.all(
                    'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
                    [entryId],
                    (editsErr, edits) => {
                        if (editsErr) {
                            res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading edit history</h1></body></html>');
                            return;
                        }
                        
                        let html = `<!DOCTYPE html>
<html>
<head>
    <title>Edit History - ${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; }
        .edit-header { background: #f5f5f5; margin: -15px -15px 10px -15px; padding: 10px 15px; }
        .diff { margin: 10px 0; }
        .added { background: #d4fdd4; padding: 2px; }
        .removed { background: #fdd4d4; padding: 2px; text-decoration: line-through; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: ${escapeHtml(entry.title)}</h1>
    <p><a href="/entries/${escapeHtml(entryId)}">Back to entry</a></p>`;
                        
                        if (edits.length === 0) {
                            html += '<p>No edits found.</p>';
                        } else {
                            edits.forEach(edit => {
                                html += `
    <div class="edit">
        <div class="edit-header">
            <strong>Modified by:</strong> ${escapeHtml(edit.modified_by)}<br>
            <strong>Date:</strong> ${escapeHtml(edit.modified_at)}<br>
            <strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary provided')}
        </div>
        <div class="diff">`;
                                
                                if (edit.previous_content) {
                                    html += `
            <div><strong>Previous content:</strong></div>
            <div class="removed">${escapeHtml(edit.previous_content)}</div>`;
                                }
                                
                                html += `
            <div><strong>New content:</strong></div>
            <div class="added">${escapeHtml(edit.new_content)}</div>
        </div>
    </div>`;
                            });
                        }
                        
                        html += `
</body>
</html>`;
                        
                        res.type('text/html').send(html);
                    }
                );
            }
        );
    } catch (err) {
        res.status(500).send('<!DOCTYPE html><html><body><h1>Error loading edit history</h1></body></html>');
    }
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});