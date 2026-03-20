<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create messages table if it doesn't exist
function initializeDatabase() {
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
}

// GET /messages - Retrieve all messages with pagination and sorting
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const sort = (req.query.sort || 'DESC').toUpperCase();
  
  // Validate sort parameter
  const sortOrder = (sort === 'ASC' || sort === 'DESC') ? sort : 'DESC';
  
  // Validate limit and offset
  if (limit < 0 || offset < 0 || !Number.isInteger(limit) || !Number.isInteger(offset)) {
    return res.status(400).send('<html><body><h1>Invalid pagination parameters</h1></body></html>');
  }
  
  const query = `
    SELECT id, username, content, created_at 
    FROM messages 
    ORDER BY created_at ${sortOrder}, id ${sortOrder}
    LIMIT ? OFFSET ?
  `;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Error fetching messages:', err.message);
      return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
    }
    
    // Generate HTML response
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>MyForum - Messages</title>
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
    }
    .message {
      background-color: white;
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 15px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .message-header {
      font-weight: bold;
      color: #0066cc;
      margin-bottom: 5px;
    }
    .message-time {
      font-size: 0.85em;
      color: #666;
      margin-bottom: 10px;
    }
    .message-content {
      color: #333;
      line-height: 1.5;
    }
    .no-messages {
      text-align: center;
      color: #666;
      padding: 40px;
    }
    .pagination {
      margin-top: 20px;
      text-align: center;
    }
    .pagination a {
      color: #0066cc;
      text-decoration: none;
      margin: 0 10px;
    }
  </style>
</head>
<body>
  <h1>MyForum Messages</h1>
`;
    
    if (rows.length === 0) {
      html += '<div class="no-messages">No messages found.</div>';
    } else {
      rows.forEach(row => {
        const username = escapeHtml(row.username);
        const content = escapeHtml(row.content);
        const timestamp = new Date(row.created_at).toLocaleString();
        
        html += `
  <div class="message">
    <div class="message-header">${username}</div>
    <div class="message-time">${timestamp}</div>
    <div class="message-content">${content}</div>
  </div>
`;
      });
    }
    
    // Add pagination links
    html += `
  <div class="pagination">
`;
    if (offset > 0) {
      const prevOffset = Math.max(0, offset - limit);
      html += `<a href="/messages?limit=${limit}&offset=${prevOffset}&sort=${sortOrder}">← Previous</a>`;
    }
    if (rows.length === limit) {
      const nextOffset = offset + limit;
      html += `<a href="/messages?limit=${limit}&offset=${nextOffset}&sort=${sortOrder}">Next →</a>`;
    }
    html += `
  </div>
</body>
</html>
`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
  const { username, content } = req.body;
  
  // Validate input
  if (!username || !content) {
    return res.status(400).json({ error: 'Username and content are required' });
  }
  
  if (typeof username !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'Username and content must be strings' });
  }
  
  if (username.trim().length === 0 || content.trim().length === 0) {
    return res.status(400).json({ error: 'Username and content cannot be empty' });
  }
  
  if (username.length > 255 || content.length > 10000) {
    return res.status(400).json({ error: 'Username or content too long' });
  }
  
  const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
  
  db.run(query, [username, content], function(err) {
    if (err) {
      console.error('Error inserting message:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.status(200).json({ 
      success: true, 
      id: this.lastID,
      message: 'Message posted successfully' 
    });
  });
});

// Helper function to escape HTML special characters
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

// Start server
app.listen(PORT, HOST, () => {
  console.log(`MyForum server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
</CODE>