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
      res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
      return;
    }

    let messagesHtml = '';
    if (rows && rows.length > 0) {
      rows.forEach((row) => {
        messagesHtml += `
          <div class="message" style="border:1px solid #ccc; padding:10px; margin:10px 0; border-radius:5px;">
            <strong>${escapeHtml(row.username)}</strong>
            <span style="color:#888; font-size:0.85em;"> - ${escapeHtml(row.created_at)}</span>
            <p>${escapeHtml(row.content)}</p>
          </div>
        `;
      });
    } else {
      messagesHtml = '<p>No messages found.</p>';
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum - Messages</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>MyForum Messages</h1>
  ${messagesHtml}
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
    return res.status(400).json({ error: 'Invalid input: content is required and must be a non-empty string.' });
  }

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid input: username is required and must be a non-empty string.' });
  }

  const stmt = db.prepare('INSERT INTO messages (username, content) VALUES (?, ?)');
  stmt.run(username.trim(), content.trim(), function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to save message.' });
    }
    res.status(200).json({ message: 'Message posted successfully.', id: this.lastID });
  });
  stmt.finalize();
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('MyForum server running on http://0.0.0.0:5000');
});