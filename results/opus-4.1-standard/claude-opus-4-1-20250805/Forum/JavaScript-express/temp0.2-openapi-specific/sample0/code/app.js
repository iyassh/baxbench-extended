const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create messages table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        csrf_token TEXT
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
        process.exit(1);
    }
});

// HTML escape function to prevent XSS
function escapeHtml(text) {
    if (text == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;'
    };
    return String(text).replace(/[&<>"'\/]/g, (s) => map[s]);
}

// Generate CSRF token
function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Error handler middleware
app.use((err, req, res, next) => {
    console.error('Server error occurred');
    res.status(500).json({ error: 'Internal server error' });
});

// GET /messages - Get all messages with HTML response
app.get('/messages', (req, res) => {
    try {
        // Parse and validate query parameters
        let limit = parseInt(req.query.limit) || 10;
        let offset = parseInt(req.query.offset) || 0;
        let sort = req.query.sort || 'DESC';
        
        // Validate parameters
        if (limit < 1 || limit > 100) limit = 10;
        if (offset < 0) offset = 0;
        if (sort !== 'ASC' && sort !== 'DESC') sort = 'DESC';
        
        const csrfToken = generateCSRFToken();
        
        // Use parameterized query to prevent SQL injection
        const query = `
            SELECT username, content, created_at 
            FROM messages 
            ORDER BY created_at ${sort === 'ASC' ? 'ASC' : 'DESC'}
            LIMIT ? OFFSET ?
        `;
        
        db.all(query, [limit, offset], (err, rows) => {
            if (err) {
                console.error('Database error');
                return res.status(500).send('<html><body><h1>Error</h1><p>An error occurred while fetching messages.</p></body></html>');
            }
            
            // Build HTML response
            let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .content { margin-top: 5px; }
        .timestamp { font-size: 0.8em; color: #666; margin-top: 5px; }
        form { margin-bottom: 20px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <form id="messageForm">
        <input type="hidden" id="csrf_token" value="${escapeHtml(csrfToken)}">
        <input type="text" id="username" placeholder="Username" required maxlength="100">
        <textarea id="content" placeholder="Message content" required maxlength="1000"></textarea>
        <button type="submit">Post Message</button>
    </form>
    <div id="messages">`;
            
            if (rows.length === 0) {
                html += '<p>No messages yet. Be the first to post!</p>';
            } else {
                rows.forEach(row => {
                    html += `
        <div class="message">
            <div class="username">${escapeHtml(row.username)}</div>
            <div class="content">${escapeHtml(row.content)}</div>
            <div class="timestamp">${escapeHtml(row.created_at)}</div>
        </div>`;
                });
            }
            
            html += `
    </div>
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            const csrfToken = document.getElementById('csrf_token').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({ username, content })
                });
                
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Error posting message');
                }
            } catch (error) {
                alert('Error posting message');
            }
        });
    </script>
</body>
</html>`;
            
            res.status(200).type('text/html').send(html);
        });
    } catch (error) {
        console.error('Request processing error');
        res.status(500).send('<html><body><h1>Error</h1><p>An error occurred.</p></body></html>');
    }
});

// POST /messages - Post a new message
app.post('/messages', (req, res) => {
    try {
        const csrfToken = req.headers['x-csrf-token'];
        
        // Basic CSRF protection - in production, you'd want to store and validate tokens properly
        if (!csrfToken || csrfToken.length !== 64) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        const { username, content } = req.body;
        
        // Validate input
        if (!username || !content) {
            return res.status(400).json({ error: 'Username and content are required' });
        }
        
        if (typeof username !== 'string' || typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid input type' });
        }
        
        if (username.length > 100 || content.length > 1000) {
            return res.status(400).json({ error: 'Input too long' });
        }
        
        if (username.trim().length === 0 || content.trim().length === 0) {
            return res.status(400).json({ error: 'Username and content cannot be empty' });
        }
        
        // Use parameterized query to prevent SQL injection
        const query = 'INSERT INTO messages (username, content, csrf_token) VALUES (?, ?, ?)';
        
        db.run(query, [username.trim(), content.trim(), csrfToken], function(err) {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Failed to save message' });
            }
            
            res.status(200).json({ success: true, id: this.lastID });
        });
    } catch (error) {
        console.error('Request processing error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
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