const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

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
    console.error('Error creating table:', err.message);
  } else {
    console.log('Messages table ready');
  }
});

// Helper function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// GET /messages - Get all previously posted messages
app.get('/messages', (req, res) => {
  // Parse query parameters with defaults
  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  let sort = req.query.sort || 'desc';
  
  // Validate parameters
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 100) limit = 100; // Prevent excessive requests
  if (isNaN(offset) || offset < 0) offset = 0;
  
  // Normalize sort parameter
  sort = sort.toUpperCase();
  if (sort !== 'ASC' && sort !== 'DESC') {
    sort = 'DESC';
  }
  
  // Query database
  const sql = `
    SELECT username, content, created_at 
    FROM messages 
    ORDER BY created_at ${sort} 
    LIMIT ? OFFSET ?
  `;
  
  db.all(sql, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).type('text/html').send('<h1>Internal Server Error</h1>');
    }
    
    // Generate HTML response
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        .post-form {
            margin-bottom: 30px;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 5px;
        }
        .post-form input, .post-form textarea {
            width: 100%;
            margin-bottom: 10px;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 3px;
            box-sizing: border-box;
        }
        .post-form button {
            background-color: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 16px;
        }
        .post-form button:hover {
            background-color: #218838;
        }
        .message {
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 10px;
            background-color: #fff;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .username {
            font-weight: bold;
            color: #007bff;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
        }
        .content {
            color: #333;
            line-height: 1.5;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
        }
        .pagination a {
            margin: 0 5px;
            padding: 8px 15px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 3px;
            display: inline-block;
        }
        .pagination a:hover {
            background-color: #0056b3;
        }
        .sort-controls {
            margin-bottom: 20px;
            text-align: right;
        }
        .sort-controls a {
            margin-left: 10px;
            color: #007bff;
            text-decoration: none;
        }
        .sort-controls a.active {
            font-weight: bold;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>MyForum</h1>
        
        <div class="post-form">
            <h2>Post a Message</h2>
            <form onsubmit="postMessage(event)">
                <input type="text" id="username" placeholder="Username" maxlength="100" required>
                <textarea id="content" placeholder="Your message" rows="3" maxlength="1000" required></textarea>
                <button type="submit">Post Message</button>
            </form>
            <div id="message-status" style="margin-top: 10px;"></div>
        </div>
        
        <div class="sort-controls">
            Sort by: 
            <a href="/messages?limit=${limit}&offset=${offset}&sort=DESC" ${sort === 'DESC' ? 'class="active"' : ''}>Newest First</a>
            <a href="/messages?limit=${limit}&offset=${offset}&sort=ASC" ${sort === 'ASC' ? 'class="active"' : ''}>Oldest First</a>
        </div>
        
        <h2>Messages</h2>`;
    
    if (rows.length === 0) {
      html += '<p>No messages yet. Be the first to post!</p>';
    } else {
      rows.forEach(message => {
        const date = new Date(message.created_at);
        html += `
        <div class="message">
            <div class="message-header">
                <span class="username">${escapeHtml(message.username)}</span>
                <span class="timestamp">${escapeHtml(date.toLocaleString())}</span>
            </div>
            <div class="content">${escapeHtml(message.content)}</div>
        </div>`;
      });
    }
    
    // Add pagination
    html += '<div class="pagination">';
    if (offset > 0) {
      const prevOffset = Math.max(0, offset - limit);
      html += `<a href="/messages?limit=${limit}&offset=${prevOffset}&sort=${sort}">← Previous</a>`;
    }
    if (rows.length === limit) {
      const nextOffset = offset + limit;
      html += `<a href="/messages?limit=${limit}&offset=${nextOffset}&sort=${sort}">Next →</a>`;
    }
    html += '</div>';
    
    html += `
    </div>
    <script>
        async function postMessage(event) {
            event.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            const statusDiv = document.getElementById('message-status');
            
            statusDiv.textContent = 'Posting...';
            statusDiv.style.color = '#666';
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, content })
                });
                
                if (response.ok) {
                    statusDiv.textContent = 'Message posted successfully!';
                    statusDiv.style.color = 'green';
                    document.getElementById('username').value = '';
                    document.getElementById('content').value = '';
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                } else {
                    const error = await response.json();
                    statusDiv.textContent = error.error || 'Error posting message';
                    statusDiv.style.color = 'red';
                }
            } catch (error) {
                statusDiv.textContent = 'Network error. Please try again.';
                statusDiv.style.color = 'red';
            }
        }
    </script>
</body>
</html>`;
    
    res.status(200).type('text/html').send(html);
  });
});

// POST /messages - Post a new message to the forum
app.post('/messages', (req, res) => {
  const { username, content } = req.body;
  
  // Validate input
  if (!username || !content) {
    return res.status(400).json({ error: 'Username and content are required' });
  }
  
  if (typeof username !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'Username and content must be strings' });
  }
  
  const trimmedUsername = username.trim();
  const trimmedContent = content.trim();
  
  if (trimmedUsername.length === 0 || trimmedContent.length === 0) {
    return res.status(400).json({ error: 'Username and content cannot be empty' });
  }
  
  if (trimmedUsername.length > 100) {
    return res.status(400).json({ error: 'Username is too long (max 100 characters)' });
  }
  
  if (trimmedContent.length > 1000) {
    return res.status(400).json({ error: 'Content is too long (max 1000 characters)' });
  }
  
  // Insert message into database using parameterized query to prevent SQL injection
  const sql = 'INSERT INTO messages (username, content) VALUES (?, ?)';
  
  db.run(sql, [trimmedUsername, trimmedContent], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Failed to save message' });
    }
    
    res.status(200).json({ 
      id: this.lastID, 
      message: 'Message posted successfully' 
    });
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).type('text/html').send('<h1>404 - Page Not Found</h1>');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).type('text/html').send('<h1>500 - Internal Server Error</h1>');
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`MyForum is running at http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});