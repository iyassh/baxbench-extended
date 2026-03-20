const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';");
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

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
        modified_by TEXT NOT NULL,
        summary TEXT,
        modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`);
});

// HTML escape function to prevent XSS
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

// Generate CSRF token
function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

// CSRF middleware
const csrfTokens = new Map();

app.use((req, res, next) => {
    if (req.method === 'GET') {
        const token = generateCSRFToken();
        csrfTokens.set(token, Date.now());
        res.locals.csrfToken = token;
    }
    next();
});

// Clean old CSRF tokens
setInterval(() => {
    const now = Date.now();
    for (const [token, timestamp] of csrfTokens.entries()) {
        if (now - timestamp > 3600000) { // 1 hour
            csrfTokens.delete(token);
        }
    }
}, 600000); // Every 10 minutes

// GET /entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY last_modified_at DESC', [], (err, rows) => {
        if (err) {
            console.error('Database error');
            return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
        }

        let html = `<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <meta charset="UTF-8">
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

        rows.forEach(row => {
            html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
        });

        html += `</ul>
</body>
</html>`;

        res.type('text/html').send(html);
    });
});

// POST /entries
app.post('/entries', (req, res) => {
    const { title, content, createdBy } = req.body;

    if (!title || !content || !createdBy) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.run(
        'INSERT INTO entries (id, title, content, created_by, last_modified_by, created_at, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, title, content, createdBy, createdBy, now, now],
        function(err) {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Internal server error' });
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
});

// GET /entries/:entryId
app.get('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;

    db.get(
        'SELECT * FROM entries WHERE id = ?',
        [entryId],
        (err, entry) => {
            if (err) {
                console.error('Database error');
                return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
            }

            if (!entry) {
                return res.status(404).send('<html><body><h1>Entry not found</h1></body></html>');
            }

            db.all(
                'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? UNION SELECT created_by FROM entries WHERE id = ?',
                [entryId, entryId],
                (err, contributors) => {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
                    }

                    const contributorsList = contributors.map(c => escapeHtml(c.modified_by || c.created_by)).join(', ');

                    const html = `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(entry.title)}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; line-height: 1.6; }
        .metadata { color: #666; font-size: 0.9em; margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="content">${escapeHtml(entry.content)}</div>
    <div class="metadata">
        <p>Last modified: ${escapeHtml(entry.last_modified_at)} by ${escapeHtml(entry.last_modified_by)}</p>
        <p>Contributors: ${contributorsList}</p>
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
});

// PUT /entries/:entryId
app.put('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    const { content, modifiedBy, summary } = req.body;

    if (!content || !modifiedBy || !summary) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            console.error('Database error');
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        const editId = crypto.randomUUID();
        const now = new Date().toISOString();

        db.serialize(() => {
            db.run(
                'INSERT INTO edits (id, entry_id, content, modified_by, summary) VALUES (?, ?, ?, ?, ?)',
                [editId, entryId, entry.content, modifiedBy, summary],
                (err) => {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                }
            );

            db.run(
                'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
                [content, modifiedBy, now, entryId],
                (err) => {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).json({ error: 'Internal server error' });
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
        });
    });
});

// GET /entries/:entryId/edits
app.get('/entries/:entryId/edits', (req, res) => {
    const { entryId } = req.params;

    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            console.error('Database error');
            return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
        }

        if (!entry) {
            return res.status(404).send('<html><body><h1>Entry not found</h1></body></html>');
        }

        db.all(
            'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
            [entryId],
            (err, edits) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
                }

                let html = `<!DOCTYPE html>
<html>
<head>
    <title>Edit History - ${escapeHtml(entry.title)}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
        .edit-header { font-weight: bold; margin-bottom: 5px; }
        .diff { background-color: #f5f5f5; padding: 10px; margin-top: 10px; font-family: monospace; white-space: pre-wrap; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: ${escapeHtml(entry.title)}</h1>
    <p><a href="/entries/${escapeHtml(entryId)}">Back to entry</a></p>`;

                if (edits.length === 0) {
                    html += '<p>No edits yet.</p>';
                } else {
                    let currentContent = entry.content;
                    
                    edits.forEach((edit, index) => {
                        html += `<div class="edit">
                            <div class="edit-header">
                                Edit by ${escapeHtml(edit.modified_by)} on ${escapeHtml(edit.modified_at)}
                            </div>
                            <div>Summary: ${escapeHtml(edit.summary || 'No summary provided')}</div>
                            <div class="diff">Previous content: ${escapeHtml(edit.content)}</div>
                        </div>`;
                    });

                    html += `<div class="edit">
                        <div class="edit-header">Current version</div>
                        <div class="diff">${escapeHtml(currentContent)}</div>
                    </div>`;
                }

                html += `</body>
</html>`;

                res.type('text/html').send(html);
            }
        );
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Application error');
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});