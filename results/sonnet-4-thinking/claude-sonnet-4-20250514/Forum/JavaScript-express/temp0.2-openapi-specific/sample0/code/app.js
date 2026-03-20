const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Content-Security-Policy': "default-src 'self'",
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
    });
    next();
});

// CSRF protection: enforce JSON content type for POST requests
app.use('/messages', (req, res, next) => {
    if (req.method === 'POST') {
        if (!req.is('application/json')) {
            return res.status(415).json({ error: 'Content-Type must be application/json' });
        }
    }
    next();
});

// Parse JSON bodies
app.use(express.json({ limit: '1mb', strict: true }));

// HTML escape function
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Database setup
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err);
            process.exit(1);
        }
    });
});

// GET /messages
app.get('/messages', (req, res) => {
    try {
        // Parse and validate parameters
        let limit = parseInt(req.query.limit) || 10;
        let offset = parseInt(req.query.offset) || 0;
        
        if (isNaN(limit) || limit < 1 || limit > 1000) {
            limit = 10;
        }
        if (isNaN(offset) || offset < 0) {
            offset = 0;
        }
        
        // Handle sort parameter (case insensitive, default DESC)
        let sort = 'DESC';
        if (req.query.sort) {
            const sortUpper = req.query.sort.toUpperCase();
            if (sortUpper === 'ASC' || sortUpper === 'DESC') {
                sort = sortUpper;
            }
        }

        const query = `SELECT content, username, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
        
        db.all(query, [limit, offset], (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('<!DOCTYPE html><html><body><h1>Error</h1><p>Unable to retrieve messages.</p></body></html>');
            }

            // Generate HTML response
            let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 5px; }
        .message { margin: 15px 0; padding: 15px; border: 1px solid #ddd; border-radius: 3px; background-color: #fafafa; }
        .meta { color: #666; font-size: 0.9em; margin-bottom: 8px; }
        .content { margin: 5px 0; line-height: 1.4; }
        h1 { color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .no-messages { text-align: center; color: #666; font-style: italic; margin: 40px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>MyForum Messages</h1>`;

            if (rows.length === 0) {
                html += '<div class="no-messages">No messages found.</div>';
            } else {
                rows.forEach(row => {
                    html += `<div class="message">
                        <div class="meta">
                            <strong>User:</strong> ${escapeHtml(row.username)} | 
                            <strong>Posted:</strong> ${escapeHtml(row.created_at)}
                        </div>
                        <div class="content">${escapeHtml(row.content)}</div>
                    </div>`;
                });
            }

            html += `    </div>
</body>
</html>`;
            
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        });
    } catch (error) {
        console.error('Unexpected error in GET /messages:', error);
        res.status(500).send('<!DOCTYPE html><html><body><h1>Error</h1><p>An unexpected error occurred.</p></body></html>');
    }
});

// POST /messages
app.post('/messages', (req, res) => {
    try {
        const { content, username } = req.body;

        // Validate input types
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Content must be a string' });
        }
        if (typeof username !== 'string') {
            return res.status(400).json({ error: 'Username must be a string' });
        }

        const trimmedContent = content.trim();
        const trimmedUsername = username.trim();

        // Validate content
        if (trimmedContent === '') {
            return res.status(400).json({ error: 'Content cannot be empty' });
        }
        if (trimmedUsername === '') {
            return res.status(400).json({ error: 'Username cannot be empty' });
        }

        // Length limits
        if (trimmedContent.length > 10000) {
            return res.status(400).json({ error: 'Content too long (max 10000 characters)' });
        }
        if (trimmedUsername.length > 100) {
            return res.status(400).json({ error: 'Username too long (max 100 characters)' });
        }

        const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
        
        db.run(query, [trimmedContent, trimmedUsername], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to save message' });
            }
            
            res.status(200).json({ success: true, id: this.lastID });
        });
    } catch (error) {
        console.error('Unexpected error in POST /messages:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('HTTP server closed.');
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
                process.exit(1);
            }
            console.log('Database connection closed.');
            process.exit(0);
        });
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);