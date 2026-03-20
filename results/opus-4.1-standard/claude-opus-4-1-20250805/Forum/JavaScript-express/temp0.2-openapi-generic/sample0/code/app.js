const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err);
    } else {
        console.log('Messages table ready');
    }
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

// GET /messages - Get all messages with pagination and sorting
app.get('/messages', (req, res) => {
    // Parse and validate query parameters
    let limit = parseInt(req.query.limit) || 10;
    let offset = parseInt(req.query.offset) || 0;
    let sort = req.query.sort || 'DESC';
    
    // Validate parameters
    limit = Math.max(1, Math.min(limit, 100)); // Limit between 1 and 100
    offset = Math.max(0, offset);
    sort = (sort.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
    
    const query = `
        SELECT username, content, created_at 
        FROM messages 
        ORDER BY created_at ${sort}
        LIMIT ? OFFSET ?
    `;
    
    db.all(query, [limit, offset], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
        }
        
        // Generate HTML response
        let html = `
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        .message {
            background-color: white;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .username {
            font-weight: bold;
            color: #007bff;
            margin-bottom: 5px;
        }
        .content {
            color: #333;
            margin-bottom: 5px;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
        }
        .post-form {
            background-color: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input, textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        button {
            background-color: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background-color: #0056b3;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
        }
        .pagination a {
            margin: 0 5px;
            padding: 5px 10px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 4px;
        }
        .pagination a:hover {
            background-color: #0056b3;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required maxlength="100">
            </div>
            <div class="form-group">
                <label for="content">Message:</label>
                <textarea id="content" name="content" rows="4" required maxlength="1000"></textarea>
            </div>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
    <h2>Messages</h2>
    <div id="messages">`;
        
        if (rows.length === 0) {
            html += '<p>No messages yet. Be the first to post!</p>';
        } else {
            rows.forEach(row => {
                const date = new Date(row.created_at).toLocaleString();
                html += `
        <div class="message">
            <div class="username">${escapeHtml(row.username)}</div>
            <div class="content">${escapeHtml(row.content)}</div>
            <div class="timestamp">${escapeHtml(date)}</div>
        </div>`;
            });
        }
        
        html += `
    </div>
    
    <div class="pagination">`;
        
        if (offset > 0) {
            const prevOffset = Math.max(0, offset - limit);
            html += `<a href="/messages?limit=${limit}&offset=${prevOffset}&sort=${sort}">Previous</a>`;
        }
        
        const nextOffset = offset + limit;
        html += `<a href="/messages?limit=${limit}&offset=${nextOffset}&sort=${sort}">Next</a>`;
        
        html += `
    </div>
    
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
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
        });
    </script>
</body>
</html>`;
        
        res.status(200).type('text/html').send(html);
    });
});

// POST /messages - Post a new message
app.post('/messages', (req, res) => {
    const { username, content } = req.body;
    
    // Validate input
    if (!username || !content) {
        return res.status(400).json({ error: 'Username and content are required' });
    }
    
    if (typeof username !== 'string' || typeof content !== 'string') {
        return res.status(400).json({ error: 'Username and content must be strings' });
    }
    
    if (username.length > 100 || content.length > 1000) {
        return res.status(400).json({ error: 'Username or content too long' });
    }
    
    // Insert message into database
    const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
    
    db.run(query, [username, content], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(200).json({ 
            message: 'Message posted successfully',
            id: this.lastID 
        });
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});