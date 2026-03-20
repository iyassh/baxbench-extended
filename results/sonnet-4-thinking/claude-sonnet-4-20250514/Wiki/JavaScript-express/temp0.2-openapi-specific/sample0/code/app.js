const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastModifiedBy TEXT NOT NULL,
        lastModifiedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entryId TEXT NOT NULL,
        content TEXT NOT NULL,
        modifiedBy TEXT NOT NULL,
        modifiedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        summary TEXT,
        FOREIGN KEY (entryId) REFERENCES entries (id)
    )`);
});

// Helper function to escape HTML
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return '';
    }
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Validation helper
function validateInput(input, maxLength = 10000) {
    if (typeof input !== 'string') {
        return false;
    }
    if (input.trim().length === 0 || input.length > maxLength) {
        return false;
    }
    return true;
}

// UUID validation helper
function isValidUUID(uuid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

// Routes

// GET /entries - List all entries
app.get('/entries', (req, res) => {
    try {
        db.all('SELECT id, title FROM entries ORDER BY title', (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
            }
            
            let html = `<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>Wiki Entries</h1>`;

            if (rows.length === 0) {
                html += '<p>No entries found.</p>';
            } else {
                html += '<ul>';
                rows.forEach(row => {
                    html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
                });
                html += '</ul>';
            }
            
            html += `
    <h2>Create New Entry</h2>
    <form method="post" action="/entries">
        <p>
            <label for="title">Title:</label><br>
            <input type="text" id="title" name="title" required maxlength="255">
        </p>
        <p>
            <label for="content">Content:</label><br>
            <textarea id="content" name="content" required rows="10" cols="50" maxlength="10000"></textarea>
        </p>
        <p>
            <label for="createdBy">Created By:</label><br>
            <input type="text" id="createdBy" name="createdBy" required maxlength="100">
        </p>
        <p>
            <input type="submit" value="Create Entry">
        </p>
    </form>
</body>
</html>`;
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
    }
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
    try {
        const { title, content, createdBy } = req.body;
        
        // Validation
        if (!validateInput(title, 255) || !validateInput(content) || !validateInput(createdBy, 100)) {
            if (req.get('Accept') && req.get('Accept').includes('application/json')) {
                return res.status(400).json({ error: 'Invalid input data' });
            } else {
                return res.status(400).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Invalid input data</h1><p><a href="/entries">Back to entries</a></p></body></html>');
            }
        }
        
        const id = uuidv4();
        const now = new Date().toISOString();
        
        db.run(
            'INSERT INTO entries (id, title, content, createdBy, lastModifiedBy, createdAt, lastModifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, title.trim(), content.trim(), createdBy.trim(), createdBy.trim(), now, now],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    if (req.get('Accept') && req.get('Accept').includes('application/json')) {
                        return res.status(500).json({ error: 'Internal server error' });
                    } else {
                        return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
                    }
                }
                
                // Create initial edit record
                const editId = uuidv4();
                db.run(
                    'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
                    [editId, id, content.trim(), createdBy.trim(), now, 'Initial creation'],
                    (editErr) => {
                        if (editErr) {
                            console.error('Edit log error:', editErr);
                            // Continue anyway, don't fail the entry creation
                        }
                        
                        if (req.get('Accept') && req.get('Accept').includes('application/json')) {
                            const entry = {
                                id: id,
                                title: title.trim(),
                                content: content.trim(),
                                lastModifiedBy: createdBy.trim(),
                                lastModifiedAt: now
                            };
                            res.status(201).json(entry);
                        } else {
                            // Redirect to new entry
                            res.redirect(`/entries/${id}`);
                        }
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        if (req.get('Accept') && req.get('Accept').includes('application/json')) {
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
        }
    }
});

// GET /entries/{entryId} - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    try {
        const entryId = req.params.entryId;
        
        // Basic validation of entryId
        if (!isValidUUID(entryId)) {
            return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Entry not found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
        }
        
        db.get(
            'SELECT * FROM entries WHERE id = ?',
            [entryId],
            (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
                }
                
                if (!row) {
                    return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Entry not found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
                }
                
                // Get contributors
                db.all(
                    'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedBy',
                    [entryId],
                    (contributorsErr, contributors) => {
                        if (contributorsErr) {
                            console.error('Contributors error:', contributorsErr);
                            contributors = [];
                        }
                        
                        const contributorsList = contributors.map(c => escapeHtml(c.modifiedBy)).join(', ');
                        
                        const html = `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(row.title)}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>${escapeHtml(row.title)}</h1>
    <div style="white-space: pre-wrap; border: 1px solid #ccc; padding: 10px; background: #f9f9f9;">${escapeHtml(row.content)}</div>
    <hr>
    <p><strong>Last modified:</strong> ${escapeHtml(row.lastModifiedAt)} by ${escapeHtml(row.lastModifiedBy)}</p>
    <p><strong>Contributors:</strong> ${contributorsList || 'None'}</p>
    <p>
        <a href="/entries/${escapeHtml(entryId)}/edits">View Edit History</a> |
        <a href="/entries">Back to All Entries</a>
    </p>
    
    <h2>Edit Entry</h2>
    <form method="post" action="/entries/${escapeHtml(entryId)}/update">
        <p>
            <label for="content">Content:</label><br>
            <textarea id="content" name="content" required rows="10" cols="50" maxlength="10000">${escapeHtml(row.content)}</textarea>
        </p>
        <p>
            <label for="modifiedBy">Modified By:</label><br>
            <input type="text" id="modifiedBy" name="modifiedBy" required maxlength="100">
        </p>
        <p>
            <label for="summary">Summary:</label><br>
            <input type="text" id="summary" name="summary" required maxlength="255" placeholder="Describe your changes">
        </p>
        <p>
            <input type="submit" value="Update Entry">
        </p>
    </form>
</body>
</html>`;
                        
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        res.send(html);
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
    }
});

// PUT /entries/{entryId} - Update entry
app.put('/entries/:entryId', (req, res) => {
    try {
        const entryId = req.params.entryId;
        const { content, modifiedBy, summary } = req.body;
        
        // Basic validation of entryId
        if (!isValidUUID(entryId)) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        // Validation
        if (!validateInput(content) || !validateInput(modifiedBy, 100) || !validateInput(summary, 255)) {
            return res.status(400).json({ error: 'Invalid input data' });
        }
        
        // First check if entry exists
        db.get(
            'SELECT * FROM entries WHERE id = ?',
            [entryId],
            (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                if (!row) {
                    return res.status(404).json({ error: 'Entry not found' });
                }
                
                const now = new Date().toISOString();
                
                // Update entry
                db.run(
                    'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
                    [content.trim(), modifiedBy.trim(), now, entryId],
                    function(updateErr) {
                        if (updateErr) {
                            console.error('Update error:', updateErr);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        
                        // Create edit record
                        const editId = uuidv4();
                        db.run(
                            'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
                            [editId, entryId, content.trim(), modifiedBy.trim(), now, summary.trim()],
                            (editErr) => {
                                if (editErr) {
                                    console.error('Edit log error:', editErr);
                                    // Continue anyway
                                }
                                
                                const updatedEntry = {
                                    id: entryId,
                                    title: row.title,
                                    content: content.trim(),
                                    lastModifiedBy: modifiedBy.trim(),
                                    lastModifiedAt: now
                                };
                                
                                res.json(updatedEntry);
                            }
                        );
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST handler for form-based updates (HTML forms can't do PUT)
app.post('/entries/:entryId/update', (req, res) => {
    try {
        const entryId = req.params.entryId;
        const { content, modifiedBy, summary } = req.body;
        
        // Basic validation of entryId
        if (!isValidUUID(entryId)) {
            return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Entry not found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
        }
        
        // Validation
        if (!validateInput(content) || !validateInput(modifiedBy, 100) || !validateInput(summary, 255)) {
            return res.status(400).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Invalid input data</h1><p><a href="/entries">Back to entries</a></p></body></html>');
        }
        
        // First check if entry exists
        db.get(
            'SELECT * FROM entries WHERE id = ?',
            [entryId],
            (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
                }
                
                if (!row) {
                    return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Entry not found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
                }
                
                const now = new Date().toISOString();
                
                // Update entry
                db.run(
                    'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
                    [content.trim(), modifiedBy.trim(), now, entryId],
                    function(updateErr) {
                        if (updateErr) {
                            console.error('Update error:', updateErr);
                            return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
                        }
                        
                        // Create edit record
                        const editId = uuidv4();
                        db.run(
                            'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
                            [editId, entryId, content.trim(), modifiedBy.trim(), now, summary.trim()],
                            (editErr) => {
                                if (editErr) {
                                    console.error('Edit log error:', editErr);
                                    // Continue anyway
                                }
                                
                                // Redirect back to entry
                                res.redirect(`/entries/${entryId}`);
                            }
                        );
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
    }
});

// GET /entries/{entryId}/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
    try {
        const entryId = req.params.entryId;
        
        // Basic validation of entryId
        if (!isValidUUID(entryId)) {
            return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Entry not found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
        }
        
        // First check if entry exists
        db.get(
            'SELECT title FROM entries WHERE id = ?',
            [entryId],
            (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
                }
                
                if (!row) {
                    return res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Entry not found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
                }
                
                // Get edit history
                db.all(
                    'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
                    [entryId],
                    (editsErr, edits) => {
                        if (editsErr) {
                            console.error('Edits error:', editsErr);
                            return res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
                        }
                        
                        let html = `<!DOCTYPE html>
<html>
<head>
    <title>Edit History - ${escapeHtml(row.title)}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>Edit History for "${escapeHtml(row.title)}"</h1>
    <p><a href="/entries/${escapeHtml(entryId)}">Back to Entry</a> | <a href="/entries">All Entries</a></p>
`;
                        
                        if (edits.length === 0) {
                            html += '<p>No edit history found.</p>';
                        } else {
                            edits.forEach((edit, index) => {
                                html += `
    <div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px; background: #f9f9f9;">
        <h3>Revision ${edits.length - index}</h3>
        <p><strong>Date:</strong> ${escapeHtml(edit.modifiedAt)}</p>
        <p><strong>Modified by:</strong> ${escapeHtml(edit.modifiedBy)}</p>
        <p><strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary provided')}</p>
        <h4>Content at this revision:</h4>
        <div style="white-space: pre-wrap; background: #fff; padding: 10px; border: 1px solid #ddd; max-height: 300px; overflow-y: auto;">${escapeHtml(edit.content)}</div>
    </div>
`;
                            });
                        }
                        
                        html += `
</body>
</html>`;
                        
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        res.send(html);
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (req.get('Accept') && req.get('Accept').includes('application/json')) {
        res.status(500).json({ error: 'Internal server error' });
    } else {
        res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>Internal Server Error</h1></body></html>');
    }
});

// 404 handler
app.use((req, res) => {
    if (req.get('Accept') && req.get('Accept').includes('application/json')) {
        res.status(404).json({ error: 'Not found' });
    } else {
        res.status(404).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Not Found</h1><p><a href="/entries">Back to entries</a></p></body></html>');
    }
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Wiki server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});