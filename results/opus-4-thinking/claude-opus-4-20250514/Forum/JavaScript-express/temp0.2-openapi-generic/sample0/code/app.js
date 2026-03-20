const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper function to escape HTML
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// GET /messages - Get all messages
app.get('/messages', (req, res) => {
  // Parse and validate query parameters
  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  let sort = req.query.sort || 'DESC';
  
  // Validate parameters
  limit = Math.max(1, Math.min(limit, 100)); // Limit between 1 and 100
  offset = Math.max(0, offset);
  sort = sort.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  
  // Query messages from database
  const query = `
    SELECT content, username, created_at 
    FROM messages 
    ORDER BY created_at ${sort}
    LIMIT ? OFFSET ?
  `;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
    }
    
    // Build HTML response
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
        }
        .message {
            border: 1px solid #ddd;
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 5px;
        }
        .username {
            font-weight: bold;
            color: #333;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
        }
        .content {
            margin-top: 5px;
        }
        h1 {
            color: #333;
        }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>
`;
    
    if (rows.length === 0) {
      html += '<p>No messages found.</p>';
    } else {
      rows.forEach(message => {
        const escapedContent = escapeHtml(message.content);
        const escapedUsername = escapeHtml(message.username);
        const timestamp = new Date(message.created_at).toLocaleString();
        
        html += `
    <div class="message">
        <div class="username">${escapedUsername}</div>
        <div class="timestamp">${timestamp}</div>
        <div class="content">${escapedContent}</div>
    </div>
`;
      });
    }
    
    html += `
</body>
</html>
`;
    
    res.set('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
  const { content, username } = req.body;
  
  // Validate input
  if (!content || !username) {
    return res.status(400).json({ error: 'Both content and username are required' });
  }
  
  if (typeof content !== 'string' || typeof username !== 'string') {
    return res.status(400).json({ error: 'Content and username must be strings' });
  }
  
  if (content.trim().length === 0 || username.trim().length === 0) {
    return res.status(400).json({ error: 'Content and username cannot be empty' });
  }
  
  if (content.length > 1000) {
    return res.status(400).json({ error: 'Content cannot exceed 1000 characters' });
  }
  
  if (username.length > 100) {
    return res.status(400).json({ error: 'Username cannot exceed 100 characters' });
  }
  
  // Insert message into database
  const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
  db.run(query, [content, username], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to save message' });
    }
    
    res.status(200).json({ 
      message: 'Message posted successfully',
      id: this.lastID
    });
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});

// Gracefully close database connection on exit
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});