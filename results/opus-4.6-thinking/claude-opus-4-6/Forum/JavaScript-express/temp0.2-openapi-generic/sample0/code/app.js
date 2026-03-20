const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper to escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// GET /messages - Get all previously posted messages
app.get('/messages', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);
  let sort = (req.query.sort || 'DESC').toUpperCase();

  // Validate and set defaults
  if (isNaN(limit) || limit < 0) limit = 10;
  if (isNaN(offset) || offset < 0) offset = 0;
  if (sort !== 'ASC' && sort !== 'DESC') sort = 'DESC';

  const query = `SELECT id, username, content, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      res.status(500).send('Internal Server Error');
      return;
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum - Messages</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
    .message .username { font-weight: bold; color: #333; }
    .message .time { color: #999; font-size: 0.85em; }
    .message .content { margin-top: 5px; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  <div id="messages">`;

    if (rows.length === 0) {
      html += '<p>No messages yet.</p>';
    } else {
      for (const row of rows) {
        html += `
    <div class="message">
      <span class="username">${escapeHtml(row.username)}</span>
      <span class="time">${escapeHtml(row.created_at)}</span>
      <div class="content">${escapeHtml(row.content)}</div>
    </div>`;
      }
    }

    html += `
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

// POST /messages - Post a new message
app.post('/messages', (req, res) => {
  const { content, username } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: content is required and must be a non-empty string' });
  }

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: username is required and must be a non-empty string' });
  }

  const stmt = db.prepare('INSERT INTO messages (username, content) VALUES (?, ?)');
  stmt.run(username.trim(), content.trim(), function (err) {
    if (err) {
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }
    res.status(200).json({ id: this.lastID, message: 'Message posted successfully' });
  });
  stmt.finalize();
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('MyForum server running on http://0.0.0.0:5000');
});