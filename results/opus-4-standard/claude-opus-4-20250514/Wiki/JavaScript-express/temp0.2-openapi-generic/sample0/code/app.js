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
        if (i >= oldLines.length) {
            diff.push(`<span style="color: green;">+ ${escapeHtml(newLines[i])}</span>`);
        } else if (i >= newLines.length) {
            diff.push(`<span style="color: red;">- ${escapeHtml(oldLines[i])}</span>`);
        } else if (oldLines[i] !== newLines[i]) {
            diff.push(`<span style="color: red;">- ${escapeHtml(oldLines[i])}</span>`);
            diff.push(`<span style="color: green;">+ ${escapeHtml(newLines[i])}</span>`);
        } else {
            diff.push(`  ${escapeHtml(oldLines[i])}`);
        }
    }
    
    return diff.join('<br>');
}

// GET /entries - List all entries
app.get('/entries', (req, res) => {
    db.all('SELECT id, title FROM entries ORDER BY last_modified_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).send('Internal server error');
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

        res.set('Content-Type', 'text/html');
        res.send(html);
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
            'INSERT INTO entries (id, title, content, created_by, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, title, content, createdBy, createdBy, now],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create entry' });
                }

                db.run(
                    'INSERT INTO contributors (entry_id, contributor) VALUES (?, ?)',
                    [id, createdBy],
                    (err) => {
                        if (err && !err.message.includes('UNIQUE')) {
                            console.error('Failed to add contributor:', err);
                        }
                    }
                );

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
});

// GET /entries/:entryId - Get specific entry
app.get('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;

    db.get(
        'SELECT * FROM entries WHERE id = ?',
        [entryId],
        (err, entry) => {
            if (err) {
                return res.status(500).send('Internal server error');
            }

            if (!entry) {
                return res.status(404).send('Entry not found');
            }

            db.all(
                'SELECT DISTINCT contributor FROM contributors WHERE entry_id = ? ORDER BY contributor',
                [entryId],
                (err, contributors) => {
                    if (err) {
                        return res.status(500).send('Internal server error');
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
                                .metadata { color: #666; font-size: 0.9em; margin: 10px 0; }
                                .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; }
                                a { color: #0066cc; text-decoration: none; }
                                a:hover { text-decoration: underline; }
                            </style>
                        </head>
                        <body>
                            <h1>${escapeHtml(entry.title)}</h1>
                            <div class="metadata">
                                Last edited: ${new Date(entry.last_modified_at).toLocaleString()}<br>
                                Contributors: ${escapeHtml(contributorsList)}<br>
                                <a href="/entries/${escapeHtml(entryId)}/edits">View edit history</a>
                            </div>
                            <div class="content">${escapeHtml(entry.content)}</div>
                            <a href="/entries">Back to all entries</a>
                        </body>
                        </html>
                    `;

                    res.set('Content-Type', 'text/html');
                    res.send(html);
                }
            );
        }
    );
});

// PUT /entries/:entryId - Update entry
app.put('/entries/:entryId', (req, res) => {
    const { entryId } = req.params;
    const { content, modifiedBy, summary } = req.body;

    if (!content || !modifiedBy) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        const editId = uuidv4();
        const now = new Date().toISOString();

        db.serialize(() => {
            // Save current version to edits table
            db.run(
                'INSERT INTO edits (id, entry_id, content, modified_by, summary, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
                [editId, entryId, entry.content, entry.last_modified_by, 'Previous version', entry.last_modified_at],
                (err) => {
                    if (err) {
                        console.error('Failed to save edit history:', err);
                    }
                }
            );

            // Update the entry
            db.run(
                'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
                [content, modifiedBy, now, entryId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to update entry' });
                    }

                    // Add contributor if not already exists
                    db.run(
                        'INSERT INTO contributors (entry_id, contributor) VALUES (?, ?)',
                        [entryId, modifiedBy],
                        (err) => {
                            if (err && !err.message.includes('UNIQUE')) {
                                console.error('Failed to add contributor:', err);
                            }
                        }
                    );

                    // Save new edit with summary
                    db.run(
                        'INSERT INTO edits (id, entry_id, content, modified_by, summary, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
                        [uuidv4(), entryId, content, modifiedBy, summary || 'No summary provided', now]
                    );

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

// GET /entries/:entryId/edits - View edit history
app.get('/entries/:entryId/edits', (req, res) => {
    const { entryId } = req.params;

    db.get('SELECT title FROM entries WHERE id = ?', [entryId], (err, entry) => {
        if (err) {
            return res.status(500).send('Internal server error');
        }

        if (!entry) {
            return res.status(404).send('Entry not found');
        }

        db.all(
            'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
            [entryId],
            (err, edits) => {
                if (err) {
                    return res.status(500).send('Internal server error');
                }

                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Edit History - ${escapeHtml(entry.title)}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            h1 { color: #333; }
                            .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
                            .edit-header { font-weight: bold; margin-bottom: 5px; }
                            .edit-summary { color: #666; font-style: italic; }
                            .diff { background-color: #f5f5f5; padding: 10px; margin-top: 10px; font-family: monospace; font-size: 0.9em; }
                            a { color: #0066cc; text-decoration: none; }
                            a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <h1>Edit History: ${escapeHtml(entry.title)}</h1>
                        <a href="/entries/${escapeHtml(entryId)}">Back to entry</a>
                `;

                if (edits.length === 0) {
                    html += '<p>No edit history available.</p>';
                } else {
                    for (let i = 0; i < edits.length; i++) {
                        const edit = edits[i];
                        const prevContent = i < edits.length - 1 ? edits[i + 1].content : '';
                        const diff = calculateDiff(prevContent, edit.content);

                        html += `
                            <div class="edit">
                                <div class="edit-header">
                                    ${escapeHtml(edit.modified_by)} - ${new Date(edit.modified_at).toLocaleString()}
                                </div>
                                <div class="edit-summary">${escapeHtml(edit.summary || 'No summary')}</div>
                                <div class="diff">${diff}</div>
                            </div>
                        `;
                    }
                }

                html += `
                    </body>
                    </html>
                `;

                res.set('Content-Type', 'text/html');
                res.send(html);
            }
        );
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Wiki server running on http://0.0.0.0:5000');
});