const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

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

// GET /messages - Get all previously posted messages
app.get('/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort || 'DESC';
    
    // Validate sort parameter
    const sortDirection = sort.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    const query = `SELECT * FROM messages ORDER BY created_at ${sortDirection} LIMIT ? OFFSET ?`;
    
    db.all(query, [limit, offset], (err, rows) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        // Generate HTML response
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; margin: 10px 0; padding: 10px; border-radius: 5px; }
        .username { font-weight: bold; color: #0066cc; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin: 10px 0; }
        .post-form { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .post-form input, .post-form textarea { width: 100%; margin: 5px 0; padding: 8px; }
        .post-form button { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; padding: 5px 10px; background: #0066cc; color: white; text-decoration: none; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h3>Post a new message</h3>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Username" required>
            <textarea id="content" placeholder="Your message..." rows="4" required></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
    <h3>Messages (${sortDirection === 'DESC' ? 'Newest First' : 'Oldest First'})</h3>
    <div class="pagination">
        Sort: 
        <a href="/messages?limit=${limit}&offset=${offset}&sort=DESC">Newest First</a>
        <a href="/messages?limit=${limit}&offset=${offset}&sort=ASC">Oldest First</a>
    </div>
    
    <div id="messages">`;

        if (rows.length === 0) {
            html += '<p>No messages yet. Be the first to post!</p>';
        } else {
            rows.forEach(message => {
                html += `
                <div class="message">
                    <div class="username">${escapeHtml(message.username)}</div>
                    <div class="timestamp">${new Date(message.created_at).toLocaleString()}</div>
                    <div class="content">${escapeHtml(message.content)}</div>
                </div>`;
            });
        }

        html += `
    </div>
    
    <div class="pagination">
        ${offset > 0 ? `<a href="/messages?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort}">Previous</a>` : ''}
        ${rows.length === limit ? `<a href="/messages?limit=${limit}&offset=${offset + limit}&sort=${sort}">Next</a>` : ''}
    </div>

    <script>
        document.getElementById('messageForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, content })
                });
                
                if (response.ok) {
                    // Reload the page to show the new message
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

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /messages - Post a new message to the forum
app.post('/messages', (req, res) => {
    const { content, username } = req.body;
    
    // Validate input
    if (!content || !username) {
        return res.status(400).json({ error: 'Content and username are required' });
    }
    
    if (typeof content !== 'string' || typeof username !== 'string') {
        return res.status(400).json({ error: 'Content and username must be strings' });
    }
    
    if (content.trim().length === 0 || username.trim().length === 0) {
        return res.status(400).json({ error: 'Content and username cannot be empty' });
    }
    
    // Insert message into database
    const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
    db.run(query, [content.trim(), username.trim()], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.status(200).json({ 
            message: 'Message posted successfully',
            id: this.lastID 
        });
    });
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
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
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