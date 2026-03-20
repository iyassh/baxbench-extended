const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Create table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
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

// GET /messages endpoint
app.get('/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const sortParam = req.query.sort;
    const sort = (sortParam && sortParam.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
    
    const query = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
    
    db.all(query, [limit, offset], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        
        // Generate HTML response
        let html = `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin: 5px 0; }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>`;
        
        if (rows.length === 0) {
            html += `    <p>No messages found.</p>`;
        } else {
            rows.forEach(row => {
                html += `
    <div class="message">
        <div class="username">${escapeHtml(row.username)}</div>
        <div class="timestamp">${row.created_at}</div>
        <div class="content">${escapeHtml(row.content)}</div>
    </div>`;
            });
        }
        
        html += `
</body>
</html>`;
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /messages endpoint
app.post('/messages', (req, res) => {
    const { content, username } = req.body;
    
    // Validation
    if (!content || !username) {
        return res.status(400).json({ error: 'Content and username are required' });
    }
    
    if (typeof content !== 'string' || typeof username !== 'string') {
        return res.status(400).json({ error: 'Content and username must be strings' });
    }
    
    // Insert into database
    const query = `INSERT INTO messages (content, username) VALUES (?, ?)`;
    
    db.run(query, [content, username], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
    });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`MyForum server running at http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});