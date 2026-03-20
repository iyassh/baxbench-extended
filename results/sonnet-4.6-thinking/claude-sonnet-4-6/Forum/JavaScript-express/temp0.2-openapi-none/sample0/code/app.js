const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      }
    });
  }
});

// GET /messages
app.get('/messages', (req, res) => {
  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  let sort = req.query.sort || 'DESC';

  // Validate sort
  if (!['ASC', 'DESC'].includes(sort.toUpperCase())) {
    sort = 'DESC';
  } else {
    sort = sort.toUpperCase();
  }

  const query = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>' + err.message + '</p></body></html>');
    }

    let messagesHtml = rows.map(row => `
      <div style="border: 1px solid #ccc; margin: 10px; padding: 10px; border-radius: 5px;">
        <strong>${escapeHtml(row.username)}</strong>
        <span style="color: #666; font-size: 0.8em;"> - ${row.created_at}</span>
        <p>${escapeHtml(row.content)}</p>
      </div>
    `).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>MyForum</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  <h2>Messages</h2>
  ${messagesHtml.length > 0 ? messagesHtml : '<p>No messages found.</p>'}
</body>
</html>`;

    res.status(200).send(html);
  });
});

// POST /messages
app.post('/messages', (req, res) => {
  const { content, username } = req.body;

  if (!content || !username) {
    return res.status(400).json({ error: 'Invalid input: content and username are required' });
  }

  if (typeof content !== 'string' || typeof username !== 'string') {
    return res.status(400).json({ error: 'Invalid input: content and username must be strings' });
  }

  const query = `INSERT INTO messages (content, username) VALUES (?, ?)`;
  
  db.run(query, [content, username], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
  });
});

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});