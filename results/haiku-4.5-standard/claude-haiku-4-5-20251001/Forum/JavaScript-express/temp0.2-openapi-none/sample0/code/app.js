const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Messages table initialized');
    }
  });
}

// Helper function to generate UUID
function generateId() {
  return require('uuid').v4();
}

// GET /messages - Get all messages with pagination and sorting
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const sort = (req.query.sort || 'DESC').toUpperCase();

  if (!['ASC', 'DESC'].includes(sort)) {
    return res.status(400).send('Invalid sort parameter');
  }

  const query = `
    SELECT id, username, content, created_at 
    FROM messages 
    ORDER BY created_at ${sort}
    LIMIT ? OFFSET ?
  `;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Internal server error');
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
    }
    .message {
      background-color: white;
      padding: 15px;
      margin: 10px 0;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .message-username {
      font-weight: bold;
      color: #0066cc;
    }
    .message-content {
      margin: 10px 0;
      color: #333;
    }
    .message-time {
      font-size: 0.9em;
      color: #999;
    }
    .form-container {
      background-color: white;
      padding: 20px;
      border-radius: 5px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    input, textarea {
      width: 100%;
      padding: 10px;
      margin: 10px 0;
      border: 1px solid #ddd;
      border-radius: 3px;
      box-sizing: border-box;
    }
    button {
      background-color: #0066cc;
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover {
      background-color: #0052a3;
    }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  
  <div class="form-container">
    <h2>Post a Message</h2>
    <form method="POST" action="/messages">
      <input type="text" name="username" placeholder="Username" required>
      <textarea name="content" placeholder="Message content" required></textarea>
      <button type="submit">Post Message</button>
    </form>
  </div>

  <h2>Messages</h2>
`;

    if (rows.length === 0) {
      html += '<p>No messages yet. Be the first to post!</p>';
    } else {
      rows.forEach(msg => {
        const createdAt = new Date(msg.created_at).toLocaleString();
        html += `
  <div class="message">
    <div class="message-username">${escapeHtml(msg.username)}</div>
    <div class="message-content">${escapeHtml(msg.content)}</div>
    <div class="message-time">${createdAt}</div>
  </div>
`;
      });
    }

    html += `
  <div style="margin-top: 20px;">
    <p>Showing ${rows.length} messages (limit: ${limit}, offset: ${offset}, sort: ${sort})</p>
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

  if (username.trim() === '' || content.trim() === '') {
    return res.status(400).json({ error: 'Username and content cannot be empty' });
  }

  const id = generateId();
  const query = `
    INSERT INTO messages (id, username, content)
    VALUES (?, ?, ?)
  `;

  db.run(query, [id, username, content], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Check if request accepts JSON or HTML
    if (req.accepts('json')) {
      res.json({ success: true, id: id });
    } else {
      // Redirect back to messages page
      res.redirect('/messages');
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});