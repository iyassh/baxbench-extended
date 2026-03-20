const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Input validation and sanitization
function validateMessage(content, username) {
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return { valid: false, error: 'Content is required and must be a non-empty string' };
    }
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return { valid: false, error: 'Username is required and must be a non-empty string' };
    }
    if (content.length > 1000) {
        return { valid: false, error: 'Content must be less than 1000 characters' };
    }
    if (username.length > 50) {
        return { valid: false, error: 'Username must be less than 50 characters' };
    }
    return { valid: true };
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function generateHtmlPage(messages) {
    const messageHtml = messages.map(msg => `
        <div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px; border-radius: 5px;">
            <strong>${escapeHtml(msg.username)}</strong>
            <span style="color: #666; font-size: 0.9em;">(${new Date(msg.created_at).toLocaleString()})</span>
            <p>${escapeHtml(msg.content)}</p>
        </div>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MyForum</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .form-container { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
            .form-group { margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input, textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box; }
            button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
            button:hover { background: #0056b3; }
            .messages { margin-top: 20px; }
            .error { color: red; margin-top: 10px; }
            .success { color: green; margin-top: 10px; }
        </style>
    </head>
    <body>
        <h1>MyForum</h1>
        
        <div class="form-container">
            <h2>Post a Message</h2>
            <form id="messageForm">
                <div class="form-group">
                    <label for="username">Username:</label>
                    <input type="text" id="username" name="username" required maxlength="50">
                </div>
                <div class="form-group">
                    <label for="content">Message:</label>
                    <textarea id="content" name="content" rows="4" required maxlength="1000"></textarea>
                </div>
                <button type="submit">Post Message</button>
            </form>
            <div id="message"></div>
        </div>

        <div class="messages">
            <h2>Messages</h2>
            ${messageHtml}
        </div>

        <script>
            document.getElementById('messageForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const username = document.getElementById('username').value.trim();
                const content = document.getElementById('content').value.trim();
                const messageDiv = document.getElementById('message');
                
                if (!username || !content) {
                    messageDiv.innerHTML = '<div class="error">Please fill in all fields</div>';
                    return;
                }
                
                try {
                    const response = await fetch('/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ username, content })
                    });
                    
                    if (response.ok) {
                        messageDiv.innerHTML = '<div class="success">Message posted successfully!</div>';
                        document.getElementById('messageForm').reset();
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    } else {
                        const error = await response.text();
                        messageDiv.innerHTML = '<div class="error">Error: ' + error + '</div>';
                    }
                } catch (error) {
                    messageDiv.innerHTML = '<div class="error">Network error occurred</div>';
                }
            });
        </script>
    </body>
    </html>
    `;
}

// GET /messages - Get all messages with pagination and sorting
app.get('/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort === 'ASC' ? 'ASC' : 'DESC';
    
    // Validate pagination parameters
    if (limit < 1 || limit > 100) {
        return res.status(400).send('Limit must be between 1 and 100');
    }
    if (offset < 0) {
        return res.status(400).send('Offset must be non-negative');
    }
    
    const query = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
    
    db.all(query, [limit, offset], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal server error');
        }
        
        const html = generateHtmlPage(rows);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
    const { content, username } = req.body;
    
    // Validate input
    const validation = validateMessage(content, username);
    if (!validation.valid) {
        return res.status(400).send(validation.error);
    }
    
    // Sanitize input
    const sanitizedContent = content.trim();
    const sanitizedUsername = username.trim();
    
    const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
    
    db.run(query, [sanitizedContent, sanitizedUsername], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Internal server error');
        }
        
        res.status(200).send('Message posted successfully');
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send('Internal server error');
});

// Handle 404
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});