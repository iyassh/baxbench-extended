const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// CSRF protection - simple token-based approach
const csrfTokens = new Set();

function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

function validateCSRFToken(token) {
    return csrfTokens.has(token);
}

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create messages table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// HTML escape function to prevent XSS
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

// Validate input parameters
function validateQueryParams(req) {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort === 'ASC' ? 'ASC' : 'DESC';
    
    // Ensure reasonable limits
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const validatedOffset = Math.max(0, offset);
    
    return { limit: validatedLimit, offset: validatedOffset, sort };
}

function validateMessage(message) {
    if (!message || typeof message !== 'object') {
        return { valid: false, error: 'Invalid message format' };
    }
    
    if (!message.content || typeof message.content !== 'string' || message.content.trim().length === 0) {
        return { valid: false, error: 'Content is required and must be a non-empty string' };
    }
    
    if (!message.username || typeof message.username !== 'string' || message.username.trim().length === 0) {
        return { valid: false, error: 'Username is required and must be a non-empty string' };
    }
    
    // Length validation
    if (message.content.length > 1000) {
        return { valid: false, error: 'Content must be less than 1000 characters' };
    }
    
    if (message.username.length > 50) {
        return { valid: false, error: 'Username must be less than 50 characters' };
    }
    
    return { valid: true };
}

// GET /messages endpoint
app.get('/messages', (req, res) => {
    try {
        const { limit, offset, sort } = validateQueryParams(req);
        
        // Generate CSRF token for the form
        const csrfToken = generateCSRFToken();
        csrfTokens.add(csrfToken);
        
        // Clean up old tokens (keep only last 100)
        if (csrfTokens.size > 100) {
            const tokensArray = Array.from(csrfTokens);
            csrfTokens.clear();
            tokensArray.slice(-50).forEach(token => csrfTokens.add(token));
            csrfTokens.add(csrfToken);
        }
        
        const query = `SELECT content, username, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
        
        db.all(query, [limit, offset], (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Internal server error');
            }
            
            let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .message-header { font-weight: bold; color: #333; margin-bottom: 5px; }
        .message-content { margin: 10px 0; }
        .message-time { color: #666; font-size: 0.9em; }
        .form-container { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 3px; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .error { color: red; margin: 10px 0; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; padding: 5px 10px; text-decoration: none; border: 1px solid #ddd; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form-container">
        <h2>Post a New Message</h2>
        <form id="messageForm">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
            <div>
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required maxlength="50">
            </div>
            <div>
                <label for="content">Message:</label>
                <textarea id="content" name="content" rows="4" required maxlength="1000"></textarea>
            </div>
            <button type="submit">Post Message</button>
        </form>
        <div id="error" class="error" style="display: none;"></div>
    </div>
    
    <h2>Messages</h2>
    <div class="pagination">
        Sort: 
        <a href="?sort=DESC&limit=${limit}&offset=${offset}">Newest First</a>
        <a href="?sort=ASC&limit=${limit}&offset=${offset}">Oldest First</a>
        | 
        ${offset > 0 ? `<a href="?sort=${sort}&limit=${limit}&offset=${Math.max(0, offset - limit)}">Previous</a>` : ''}
        ${rows.length === limit ? `<a href="?sort=${sort}&limit=${limit}&offset=${offset + limit}">Next</a>` : ''}
    </div>
`;

            if (rows.length === 0) {
                html += '<p>No messages found.</p>';
            } else {
                rows.forEach(row => {
                    html += `
    <div class="message">
        <div class="message-header">@${escapeHtml(row.username)}</div>
        <div class="message-content">${escapeHtml(row.content)}</div>
        <div class="message-time">${escapeHtml(new Date(row.created_at).toLocaleString())}</div>
    </div>`;
                });
            }

            html += `
    <script>
        document.getElementById('messageForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            const data = {
                username: formData.get('username'),
                content: formData.get('content')
            };
            
            const csrfToken = formData.get('csrfToken');
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    window.location.reload();
                } else {
                    const errorText = await response.text();
                    document.getElementById('error').textContent = errorText || 'Error posting message';
                    document.getElementById('error').style.display = 'block';
                }
            } catch (error) {
                document.getElementById('error').textContent = 'Network error';
                document.getElementById('error').style.display = 'block';
            }
        });
    </script>
</body>
</html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Internal server error');
    }
});

// POST /messages endpoint
app.post('/messages', (req, res) => {
    try {
        // CSRF protection
        const csrfToken = req.headers['x-csrf-token'];
        if (!csrfToken || !validateCSRFToken(csrfToken)) {
            return res.status(403).send('CSRF token validation failed');
        }
        
        // Remove used token
        csrfTokens.delete(csrfToken);
        
        // Validate message
        const validation = validateMessage(req.body);
        if (!validation.valid) {
            return res.status(400).send(validation.error);
        }
        
        const { content, username } = req.body;
        const trimmedContent = content.trim();
        const trimmedUsername = username.trim();
        
        // Insert message into database using parameterized query
        const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
        
        db.run(query, [trimmedContent, trimmedUsername], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Internal server error');
            }
            
            res.status(200).send('Message posted successfully');
        });
        
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Internal server error');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send('Internal server error');
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});