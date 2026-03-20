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
    res.setHeader('X-XSS-Protection', '1; mode=block');
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
    )`, (err) => {
        if (err) console.error('Error creating entries table:', err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS edits (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        content TEXT NOT NULL,
        modified_by TEXT NOT NULL,
        summary TEXT,
        modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entry_id) REFERENCES entries(id)
    )`, (err) => {
        if (err) console.error('Error creating edits table:', err.message);
    });
});

// HTML escape function to prevent XSS
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

// Generate UUID
function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY title ASC', [], (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            res.status(500).send('Internal server error');
            return;
        }

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
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
        
        rows.forEach(row => {
            html += `<li><a href="/entries/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></li>`;
        });
        
        html += `</ul>
</body>
</html>`;
        
        res.type('text/html').send(html);
    });
});

// POST /entries - Create new entry
app.post('/entries', (req, res) => {
    const { title, content, createdBy } = req.body;
    
    if (!title || !content || !createdBy) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    
    const id = generateId();
    const now = new Date().toISOString();
    
    db.run(
        'INSERT INTO entries (id, title, content, created_by, last_modified_by, created_at, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, title, content, createdBy, createdBy, now, now],
        function(err) {
            if (err) {
                console.error('Database error:', err.message);
                res.status(500).json({ error: 'Internal server error' });
                return;
            }
            
            // Also create initial edit record
            const editId = generateId();
            db.run(
                'INSERT INTO edits (id, entry_id, content, modified_by, summary, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
                [editId, id, content, createdBy, 'Initial creation', now],
                (editErr) => {
                    if (editErr) {
                        console.error('Database error:', editErr.message);
                    }
                }
            );
            
            res.status(201).json({
                id: id,
                title: title,
                content: content,
                lastModifiedBy: createdBy,
                lastModifiedAt: now
            });
        }
    );
});

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    const entryId = req.params.entryId;
    
    db.get(
        'SELECT * FROM entries WHERE id = ?',
        [entryId],
        (err, entry) => {
            if (err) {
                console.error('Database error:', err.message);
                res.status(500).send('Internal server error');
                return;
            }
            
            if (!entry) {
                res.status(404).send('Entry not found');
                return;
            }
            
            // Get all contributors
            db.all(
                'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_at',
                [entryId],
                (contribErr, contributors) => {
                    if (contribErr) {
                        console.error('Database error:', contribErr.message);
                        res.status(500).send('Internal server error');
                        return;
                    }
                    
                    const contributorsList = contributors.map(c => escapeHtml(c.modified_by)).join(', ');
                    
                    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; line-height: 1.6; }
        .metadata { color: #666; font-size: 0.9em; margin-top: 20px; }
        .links { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="content">${escapeHtml(entry.content)}</div>
    <div class="metadata">
        <p>Last modified: ${escapeHtml(entry.last_modified_at)}</p>
        <p>Contributors: ${contributorsList}</p>
    </div>
    <div class="links">
        <a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a> | 
        <a href="/entries">Back to all entries</a>
    </div>
</body>
</html>`;
                    
                    res.type('text/html').send(html);
                }
            );
        }
    );
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
    const entryId = req.params.entryId;
    const { content, modifiedBy, summary } = req.body;
    
    if (!content || !modifiedBy || !summary) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    
    // Check if entry exists
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            console.error('Database error:', err.message);
            res.status(500).json({ error: 'Internal server error' });
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
                    console.error('Database error:', updateErr.message);
                    res.status(500).json({ error: 'Internal server error' });
                    return;
                }
                
                // Add edit record
                const editId = generateId();
                db.run(
                    'INSERT INTO edits (id, entry_id, content, modified_by, summary, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
                    [editId, entryId, content, modifiedBy, summary, now],
                    (editErr) => {
                        if (editErr) {
                            console.error('Database error:', editErr.message);
                        }
                    }
                );
                
                res.json({
                    id: entryId,
                    title: entry.title,
                    content: content,
                    lastModifiedBy: modifiedBy,
                    lastModifiedAt: now
                });
            }
        );
    });
});

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
    const entryId = req.params.entryId;
    
    // Check if entry exists
    db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            console.error('Database error:', err.message);
            res.status(500).send('Internal server error');
            return;
        }
        
        if (!entry) {
            res.status(404).send('Entry not found');
            return;
        }
        
        // Get all edits
        db.all(
            'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
            [entryId],
            (editsErr, edits) => {
                if (editsErr) {
                    console.error('Database error:', editsErr.message);
                    res.status(500).send('Internal server error');
                    return;
                }
                
                let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Edit History - ${escapeHtml(entry.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
        .edit-header { background: #f5f5f5; padding: 5px; margin: -10px -10px 10px -10px; }
        .diff { background: #f9f9f9; padding: 10px; font-family: monospace; white-space: pre-wrap; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: ${escapeHtml(entry.title)}</h1>`;
                
                for (let i = 0; i < edits.length; i++) {
                    const edit = edits[i];
                    const previousContent = i < edits.length - 1 ? edits[i + 1].content : '';
                    
                    html += `
    <div class="edit">
        <div class="edit-header">
            <strong>Modified by:</strong> ${escapeHtml(edit.modified_by)} | 
            <strong>Date:</strong> ${escapeHtml(edit.modified_at)} | 
            <strong>Summary:</strong> ${escapeHtml(edit.summary || 'No summary')}
        </div>
        <div class="diff">`;
                    
                    if (i === edits.length - 1) {
                        html += `Initial content:\n${escapeHtml(edit.content)}`;
                    } else {
                        html += `Content changed to:\n${escapeHtml(edit.content)}`;
                    }
                    
                    html += `</div>
    </div>`;
                }
                
                html += `
    <div style="margin-top: 20px;">
        <a href="/entries/${escapeHtml(entryId)}">Back to entry</a> | 
        <a href="/entries">Back to all entries</a>
    </div>
</body>
</html>`;
                
                res.type('text/html').send(html);
            }
        );
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).send('Internal server error');
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Wiki server running on http://${HOST}:${PORT}`);
});