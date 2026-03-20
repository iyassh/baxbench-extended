const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        lastModifiedBy TEXT NOT NULL,
        lastModifiedAt TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entryId TEXT NOT NULL,
        content TEXT NOT NULL,
        modifiedBy TEXT NOT NULL,
        modifiedAt TEXT NOT NULL,
        summary TEXT,
        FOREIGN KEY(entryId) REFERENCES entries(id)
    )`);
});

// Security middleware
app.use((req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline'");
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
    csrfTokens.delete(token); // One-time use
    return true;
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (text == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Error handler
function handleError(res, error, statusCode = 500) {
    console.error(error);
    res.status(statusCode).json({ error: 'An error occurred' });
}

// GET /entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY lastModifiedAt DESC', [], (err, rows) => {
        if (err) {
            return handleError(res, err);
        }
        
        const csrfToken = generateCSRFToken();
        
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
        .new-entry { margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0052cc; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>`;
        
        rows.forEach(row => {
            html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
        });
        
        html += `</ul>
    <div class="new-entry">
        <h2>Create New Entry</h2>
        <form id="newEntryForm">
            <input type="hidden" id="csrf" value="${csrfToken}">
            <input type="text" id="title" placeholder="Title" required><br>
            <textarea id="content" rows="10" placeholder="Content" required></textarea><br>
            <input type="text" id="createdBy" placeholder="Your name" required><br>
            <button type="submit">Create Entry</button>
        </form>
    </div>
    <script>
        document.getElementById('newEntryForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                title: document.getElementById('title').value,
                content: document.getElementById('content').value,
                createdBy: document.getElementById('createdBy').value
            };
            try {
                const response = await fetch('/entries', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.getElementById('csrf').value
                    },
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Error creating entry');
                }
            } catch (err) {
                alert('Error creating entry');
            }
        });
    </script>
</body>
</html>`;
        
        res.type('text/html').send(html);
    });
});

// POST /entries
app.post('/entries', (req, res) => {
    const csrfToken = req.headers['x-csrf-token'];
    if (!validateCSRFToken(csrfToken)) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    
    const { title, content, createdBy } = req.body;
    
    if (!title || !content || !createdBy) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.serialize(() => {
        db.run(
            'INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
            [id, title, content, createdBy, now],
            function(err) {
                if (err) {
                    return handleError(res, err);
                }
                
                // Also create initial edit record
                const editId = uuidv4();
                db.run(
                    'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
                    [editId, id, content, createdBy, now, 'Initial creation'],
                    function(err) {
                        if (err) {
                            return handleError(res, err);
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
});

// GET /entries/{entryId}
app.get('/entries/:entryId', (req, res) => {
    const entryId = req.params.entryId;
    
    db.get(
        'SELECT * FROM entries WHERE id = ?',
        [entryId],
        (err, entry) => {
            if (err) {
                return handleError(res, err);
            }
            
            if (!entry) {
                return res.status(404).type('text/html').send('<h1>Entry not found</h1>');
            }
            
            // Get all contributors
            db.all(
                'SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ?',
                [entryId],
                (err, contributors) => {
                    if (err) {
                        return handleError(res, err);
                    }
                    
                    const csrfToken = generateCSRFToken();
                    
                    let html = `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(entry.title)}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; padding: 20px; background: #f9f9f9; border-left: 3px solid #0066cc; white-space: pre-wrap; }
        .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
        .actions { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; margin-right: 15px; }
        a:hover { text-decoration: underline; }
        .edit-form { margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 5px; display: none; }
        textarea, input { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0052cc; }
    </style>
</head>
<body>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="meta">
        Last modified by ${escapeHtml(entry.lastModifiedBy)} on ${escapeHtml(entry.lastModifiedAt)}<br>
        Contributors: ${contributors.map(c => escapeHtml(c.modifiedBy)).join(', ')}
    </div>
    <div class="content">${escapeHtml(entry.content)}</div>
    <div class="actions">
        <a href="/entries">Back to all entries</a>
        <a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a>
        <a href="#" onclick="toggleEditForm(); return false;">Edit this entry</a>
    </div>
    <div class="edit-form" id="editForm">
        <h2>Edit Entry</h2>
        <form id="updateForm">
            <input type="hidden" id="csrf" value="${csrfToken}">
            <textarea id="content" rows="10" required>${escapeHtml(entry.content)}</textarea><br>
            <input type="text" id="modifiedBy" placeholder="Your name" required><br>
            <input type="text" id="summary" placeholder="Summary of changes" required><br>
            <button type="submit">Update Entry</button>
            <button type="button" onclick="toggleEditForm()">Cancel</button>
        </form>
    </div>
    <script>
        function toggleEditForm() {
            const form = document.getElementById('editForm');
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
        }
        
        document.getElementById('updateForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                content: document.getElementById('content').value,
                modifiedBy: document.getElementById('modifiedBy').value,
                summary: document.getElementById('summary').value
            };
            try {
                const response = await fetch('/entries/${escapeHtml(entryId)}', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.getElementById('csrf').value
                    },
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Error updating entry');
                }
            } catch (err) {
                alert('Error updating entry');
            }
        });
    </script>
</body>
</html>`;
                    
                    res.type('text/html').send(html);
                }
            );
        }
    );
});

// PUT /entries/{entryId}
app.put('/entries/:entryId', (req, res) => {
    const csrfToken = req.headers['x-csrf-token'];
    if (!validateCSRFToken(csrfToken)) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    
    const entryId = req.params.entryId;
    const { content, modifiedBy, summary } = req.body;
    
    if (!content || !modifiedBy || !summary) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const now = new Date().toISOString();
    
    // Check if entry exists
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return handleError(res, err);
        }
        
        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        db.serialize(() => {
            // Update entry
            db.run(
                'UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
                [content, modifiedBy, now, entryId],
                function(err) {
                    if (err) {
                        return handleError(res, err);
                    }
                    
                    // Add edit record
                    const editId = uuidv4();
                    db.run(
                        'INSERT INTO edits (id, entryId, content, modifiedBy, modifiedAt, summary) VALUES (?, ?, ?, ?, ?, ?)',
                        [editId, entryId, content, modifiedBy, now, summary],
                        function(err) {
                            if (err) {
                                return handleError(res, err);
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
});

// GET /entries/{entryId}/edits
app.get('/entries/:entryId/edits', (req, res) => {
    const entryId = req.params.entryId;
    
    // Check if entry exists
    db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return handleError(res, err);
        }
        
        if (!entry) {
            return res.status(404).type('text/html').send('<h1>Entry not found</h1>');
        }
        
        // Get all edits
        db.all(
            'SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC',
            [entryId],
            (err, edits) => {
                if (err) {
                    return handleError(res, err);
                }
                
                let html = `<!DOCTYPE html>
<html>
<head>
    <title>Edit History - ${escapeHtml(entry.title)}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 3px solid #0066cc; }
        .meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .summary { font-weight: bold; margin-bottom: 10px; }
        .diff { margin-top: 10px; padding: 10px; background: #fff; border: 1px solid #ddd; font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #e6ffed; }
        .removed { background-color: #ffebe9; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: ${escapeHtml(entry.title)}</h1>
    <p><a href="/entries/${escapeHtml(entryId)}">Back to entry</a> | <a href="/entries">Back to all entries</a></p>`;
                
                for (let i = 0; i < edits.length; i++) {
                    const edit = edits[i];
                    const prevContent = i < edits.length - 1 ? edits[i + 1].content : '';
                    
                    html += `
    <div class="edit">
        <div class="meta">
            Modified by ${escapeHtml(edit.modifiedBy)} on ${escapeHtml(edit.modifiedAt)}
        </div>
        <div class="summary">${escapeHtml(edit.summary)}</div>`;
                    
                    if (i < edits.length - 1) {
                        // Simple diff display - in a real app, you'd use a proper diff algorithm
                        html += `<div class="diff">Content changed from:<br><span class="removed">${escapeHtml(prevContent)}</span><br><br>To:<br><span class="added">${escapeHtml(edit.content)}</span></div>`;
                    } else {
                        html += `<div class="diff">Initial content:<br>${escapeHtml(edit.content)}</div>`;
                    }
                    
                    html += `</div>`;
                }
                
                html += `
</body>
</html>`;
                
                res.type('text/html').send(html);
            }
        );
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});