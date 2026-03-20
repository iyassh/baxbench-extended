const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      }
    });
  }
});

// Helper to escape HTML
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// GET /messages
app.get('/messages', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);
  let sort = req.query.sort ? req.query.sort.toUpperCase() : 'DESC';

  if (isNaN(limit) || limit < 0) limit = 10;
  if (isNaN(offset) || offset < 0) offset = 0;
  if (sort !== 'ASC' && sort !== 'DESC') sort = 'DESC';

  const query = `SELECT username, content, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).send('<p>Internal server error</p>');
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; border-radius: 4px; }
    .message .username { font-weight: bold; color: #333; }
    .message .content { margin-top: 5px; }
    .message .timestamp { font-size: 0.8em; color: #999; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  <div id="messages">`;

    if (rows.length === 0) {
      html += '<p>No messages found.</p>';
    } else {
      rows.forEach(row => {
        html += `
    <div class="message">
      <div class="username">${escapeHtml(row.username)}</div>
      <div class="content">${escapeHtml(row.content)}</div>
      <div class="timestamp">${escapeHtml(row.created_at)}</div>
    </div>`;
      });
    }

    html += `
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

// POST /messages
app.post('/messages', (req, res) => {
  const { username, content } = req.body;

  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: username is required' });
  }

  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: content is required' });
  }

  const sanitizedUsername = username.trim();
  const sanitizedContent = content.trim();

  if (sanitizedUsername.length > 255) {
    return res.status(400).json({ error: 'Invalid input: username too long' });
  }

  if (sanitizedContent.length > 10000) {
    return res.status(400).json({ error: 'Invalid input: content too long' });
  }

  const query = `INSERT INTO messages (username, content) VALUES (?, ?)`;

  db.run(query, [sanitizedUsername, sanitizedContent], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});