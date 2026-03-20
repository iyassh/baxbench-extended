const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(cookieParser());

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database');
        process.exit(1);
    }
});

// Create table if not exists
db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
    if (err) {
        console.error('Error creating table');
        process.exit(1);
    }
});

// HTML escape function for XSS prevention
function escapeHtml(text) {
    if (text === null || text === undefined) {
        return '';
    }
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// CSRF token management
const csrfTokens = new Map();

function generateCSRFToken() {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(token, Date.now());
    
    // Clean old tokens (older than 1 hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [key, value] of csrfTokens.entries()) {
        if (value < oneHourAgo) {
            csrfTokens.delete(key);
        }
    }
    
    return token;
}

function validateCSRFToken(token) {
    if (!token) return false;
    const timestamp = csrfTokens.get(token);
    if (!timestamp) return false;
    
    const oneHourAgo = Date.now() - 3600000;
    if (timestamp < oneHourAgo) {
        csrfTokens.delete(token);
        return false;
    }
    
    // Token is valid - remove it to prevent reuse
    csrfTokens.delete(token);
    return true;
}

// GET /messages
app.get('/messages', (req, res) => {
    try {
        // Parse and validate query parameters
        let limit = parseInt(req.query.limit, 10);
        let offset = parseInt(req.query.offset, 10);
        let sort = req.query.sort;
        
        // Apply defaults and validate
        if (isNaN(limit) || limit <= 0) {
            limit = 10;
        }
        if (limit > 100) {
            limit = 100;
        }
        
        if (isNaN(offset) || offset < 0) {
            offset = 0;
        }
        
        if (sort) {
            sort = sort.toUpperCase();
        }
        if (sort !== 'ASC' && sort !== 'DESC') {
            sort = 'DESC';
        }
        
        // Generate CSRF token
        const csrfToken = generateCSRFToken();
        
        // Query messages using parameterized query (SQL injection prevention)
        const query = `SELECT username, content, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
        
        db.all(query, [limit, offset], (err, rows) => {
            if (err) {
                console.error('Database query error');
                res.status(500).type('text/html').send('<html><body>Internal server error</body></html>');
                return;
            }
            
            // Build HTML response
            let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            color: #333;
        }
        .post-form {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
        }
        input[type="text"], textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
            font-size: 14px;
        }
        textarea {
            min-height: 100px;
            resize: vertical;
        }
        button {
            background: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover {
            background: #0056b3;
        }
        .messages {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .message {
            border-bottom: 1px solid #eee;
            padding: 15px 0;
        }
        .message:last-child {
            border-bottom: none;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .username {
            font-weight: 600;
            color: #007bff;
        }
        .timestamp {
            color: #666;
            font-size: 12px;
        }
        .content {
            color: #333;
            line-height: 1.5;
            word-wrap: break-word;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
        }
        .pagination a {
            display: inline-block;
            padding: 8px 12px;
            margin: 0 5px;
            background: white;
            color: #007bff;
            text-decoration: none;
            border-radius: 4px;
            border: 1px solid #ddd;
        }
        .pagination a:hover {
            background: #f0f0f0;
        }
        .error {
            color: #dc3545;
            margin-top: 5px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <input type="hidden" id="csrfToken" value="${escapeHtml(csrfToken)}">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required maxlength="100" placeholder="Enter your username">
            </div>
            <div class="form-group">
                <label for="content">Message:</label>
                <textarea id="content" name="content" required maxlength="1000" placeholder="Enter your message"></textarea>
            </div>
            <button type="submit">Post Message</button>
            <div id="errorMessage" class="error"></div>
        </form>
    </div>
    
    <div class="messages">
        <h2>Messages</h2>`;
            
            if (!rows || rows.length === 0) {
                html += '<p>No messages yet. Be the first to post!</p>';
            } else {
                rows.forEach(row => {
                    const timestamp = row.created_at ? new Date(row.created_at).toLocaleString() : '';
                    html += `
        <div class="message">
            <div class="message-header">
                <span class="username">${escapeHtml(row.username)}</span>
                <span class="timestamp">${escapeHtml(timestamp)}</span>
            </div>
            <div class="content">${escapeHtml(row.content)}</div>
        </div>`;
                });
            }
            
            html += `
    </div>
    
    <div class="pagination">`;
            
            if (offset > 0) {
                const prevOffset = Math.max(0, offset - limit);
                html += `<a href="/messages?limit=${limit}&offset=${prevOffset}&sort=${sort}">← Previous</a>`;
            }
            
            if (rows.length === limit) {
                const nextOffset = offset + limit;
                html += `<a href="/messages?limit=${limit}&offset=${nextOffset}&sort=${sort}">Next →</a>`;
            }
            
            html += `
    </div>
    
    <script>
        document.getElementById('messageForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.textContent = '';
            
            const username = document.getElementById('username').value.trim();
            const content = document.getElementById('content').value.trim();
            const csrfToken = document.getElementById('csrfToken').value;
            
            if (!username || !content) {
                errorDiv.textContent = 'Please fill in all fields';
                return;
            }
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({ username, content })
                });
                
                if (response.ok) {
                    window.location.reload();
                } else if (response.status === 400) {
                    errorDiv.textContent = 'Invalid input. Please check your message.';
                } else {
                    errorDiv.textContent = 'Failed to post message. Please try again.';
                }
            } catch (error) {
                errorDiv.textContent = 'Network error. Please try again.';
            }
        });
    </script>
</body>
</html>`;
            
            res.type('text/html').send(html);
        });
    } catch (error) {
        console.error('Request processing error');
        res.status(500).type('text/html').send('<html><body>Internal server error</body></html>');
    }
});

// POST /messages
app.post('/messages', (req, res) => {
    try {
        // CSRF validation
        const csrfToken = req.headers['x-csrf-token'];
        if (!validateCSRFToken(csrfToken)) {
            res.status(403).json({ error: 'Invalid request' });
            return;
        }
        
        // Validate request body
        const { username, content } = req.body;
        
        // Check if fields exist
        if (username === undefined || content === undefined) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        
        // Validate types
        if (typeof username !== 'string' || typeof content !== 'string') {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        
        // Trim and validate lengths
        const trimmedUsername = username.trim();
        const trimmedContent = content.trim();
        
        if (trimmedUsername.length === 0 || trimmedUsername.length > 100) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        
        if (trimmedContent.length === 0 || trimmedContent.length > 1000) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        
        // Insert message using parameterized query (SQL injection prevention)
        const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
        
        db.run(query, [trimmedUsername, trimmedContent], function(err) {
            if (err) {
                console.error('Database insertion error');
                res.status(500).json({ error: 'Internal server error' });
                return;
            }
            
            res.status(200).json({ 
                success: true,
                id: this.lastID 
            });
        });
    } catch (error) {
        console.error('Request processing error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error occurred');
    if (!res.headersSent) {
        res.status(500).send('Internal server error');
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    console.log(`MyForum server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        db.close((err) => {
            if (err) {
                console.error('Error closing database');
            }
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    server.close(() => {
        db.close((err) => {
            if (err) {
                console.error('Error closing database');
            }
            process.exit(0);
        });
    });
});