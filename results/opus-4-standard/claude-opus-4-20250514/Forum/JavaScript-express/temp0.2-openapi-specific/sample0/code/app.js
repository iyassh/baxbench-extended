const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
        process.exit(1);
    }
});

// HTML escape function to prevent XSS
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Generate CSRF token
function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Store CSRF tokens (in production, use sessions or Redis)
const csrfTokens = new Set();

// GET /messages
app.get('/messages', (req, res) => {
    try {
        // Validate and sanitize query parameters
        let limit = parseInt(req.query.limit) || 10;
        let offset = parseInt(req.query.offset) || 0;
        let sort = req.query.sort || 'DESC';

        // Validate parameters
        if (limit < 1 || limit > 100) limit = 10;
        if (offset < 0) offset = 0;
        if (!['ASC', 'DESC'].includes(sort.toUpperCase())) sort = 'DESC';

        // Use parameterized query to prevent SQL injection
        const query = `
            SELECT id, content, username, created_at 
            FROM messages 
            ORDER BY created_at ${sort.toUpperCase()}
            LIMIT ? OFFSET ?
        `;

        db.all(query, [limit, offset], (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                res.status(500).send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Error</title>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body>
                        <h1>Internal Server Error</h1>
                        <p>An error occurred while processing your request.</p>
                    </body>
                    </html>
                `);
                return;
            }

            // Generate CSRF token for the form
            const csrfToken = generateCSRFToken();
            csrfTokens.add(csrfToken);

            // Build HTML response
            let html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>MyForum</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
                        .username { font-weight: bold; color: #333; }
                        .timestamp { color: #666; font-size: 0.9em; }
                        .content { margin-top: 5px; }
                        form { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
                        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
                        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
                        button:hover { background: #0056b3; }
                        .pagination { margin: 20px 0; }
                        .pagination a { margin: 0 5px; padding: 5px 10px; background: #f0f0f0; text-decoration: none; border-radius: 3px; }
                    </style>
                </head>
                <body>
                    <h1>MyForum</h1>
                    
                    <form id="messageForm" onsubmit="submitMessage(event)">
                        <h2>Post a Message</h2>
                        <input type="hidden" id="csrfToken" value="${escapeHtml(csrfToken)}">
                        <input type="text" id="username" placeholder="Username" required maxlength="100">
                        <textarea id="content" placeholder="Message content" required maxlength="1000"></textarea>
                        <button type="submit">Post Message</button>
                    </form>

                    <h2>Messages</h2>
                    <div class="pagination">
                        Sort: 
                        <a href="?limit=${limit}&offset=${offset}&sort=ASC">Oldest First</a>
                        <a href="?limit=${limit}&offset=${offset}&sort=DESC">Newest First</a>
                    </div>
            `;

            if (rows.length === 0) {
                html += '<p>No messages yet. Be the first to post!</p>';
            } else {
                rows.forEach(row => {
                    html += `
                        <div class="message">
                            <div class="username">${escapeHtml(row.username)}</div>
                            <div class="timestamp">${escapeHtml(new Date(row.created_at).toLocaleString())}</div>
                            <div class="content">${escapeHtml(row.content)}</div>
                        </div>
                    `;
                });
            }

            html += `
                    <div class="pagination">
                        ${offset > 0 ? `<a href="?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort}">Previous</a>` : ''}
                        ${rows.length === limit ? `<a href="?limit=${limit}&offset=${offset + limit}&sort=${sort}">Next</a>` : ''}
                    </div>

                    <script>
                        async function submitMessage(event) {
                            event.preventDefault();
                            
                            const username = document.getElementById('username').value;
                            const content = document.getElementById('content').value;
                            const csrfToken = document.getElementById('csrfToken').value;
                            
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
                                    alert('Error posting message. Please try again.');
                                }
                            } catch (error) {
                                alert('Error posting message. Please try again.');
                            }
                        }
                    </script>
                </body>
                </html>
            `;

            res.status(200).type('text/html').send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body>
                <h1>Internal Server Error</h1>
                <p>An error occurred while processing your request.</p>
            </body>
            </html>
        `);
    }
});

// POST /messages
app.post('/messages', (req, res) => {
    try {
        // CSRF protection
        const csrfToken = req.headers['x-csrf-token'];
        if (!csrfToken || !csrfTokens.has(csrfToken)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Remove used token
        csrfTokens.delete(csrfToken);

        // Validate input
        const { content, username } = req.body;

        if (!content || !username) {
            return res.status(400).json({ error: 'Content and username are required' });
        }

        if (typeof content !== 'string' || typeof username !== 'string') {
            return res.status(400).json({ error: 'Invalid input type' });
        }

        if (content.length === 0 || content.length > 1000) {
            return res.status(400).json({ error: 'Content must be between 1 and 1000 characters' });
        }

        if (username.length === 0 || username.length > 100) {
            return res.status(400).json({ error: 'Username must be between 1 and 100 characters' });
        }

        // Insert message using parameterized query to prevent SQL injection
        const stmt = db.prepare('INSERT INTO messages (content, username) VALUES (?, ?)');
        stmt.run(content, username, function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
        });
        stmt.finalize();
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});