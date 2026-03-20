const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
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
`);

// GET /messages - Get all previously posted messages
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const sort = req.query.sort?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const query = `
    SELECT * FROM messages 
    ORDER BY created_at ${sort}
    LIMIT ? OFFSET ?
  `;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal server error');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>MyForum</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
          .username { font-weight: bold; color: #333; }
          .timestamp { color: #666; font-size: 0.9em; }
          .content { margin-top: 5px; }
          form { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
          input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
          button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
          button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <h1>MyForum</h1>
        <form action="/messages" method="post">
          <h3>Post a new message</h3>
          <input type="text" name="username" placeholder="Username" required>
          <textarea name="content" placeholder="Message content" rows="4" required></textarea>
          <button type="submit">Post Message</button>
        </form>
        <h3>Messages</h3>
    `;

    if (rows.length === 0) {
      html += '<p>No messages yet. Be the first to post!</p>';
    } else {
      rows.forEach(row => {
        const date = new Date(row.created_at).toLocaleString();
        html += `
          <div class="message">
            <div class="username">${escapeHtml(row.username)}</div>
            <div class="timestamp">${date}</div>
            <div class="content">${escapeHtml(row.content)}</div>
          </div>
        `;
      });
    }

    html += `
        <div style="margin-top: 20px;">
          <a href="/messages?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort.toLowerCase()}">← Previous</a>
          |
          <a href="/messages?limit=${limit}&offset=${offset + limit}&sort=${sort.toLowerCase()}">Next →</a>
        </div>
      </body>
      </html>
    `;

    res.type('text/html').send(html);
  });
});

// POST /messages - Post a new message to the forum
app.post('/messages', (req, res) => {
  const { username, content } = req.body;

  // Validate input
  if (!username || !content) {
    return res.status(400).send('Invalid input: username and content are required');
  }

  if (typeof username !== 'string' || typeof content !== 'string') {
    return res.status(400).send('Invalid input: username and content must be strings');
  }

  if (username.trim() === '' || content.trim() === '') {
    return res.status(400).send('Invalid input: username and content cannot be empty');
  }

  // Insert message into database
  const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
  db.run(query, [username.trim(), content.trim()], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal server error');
    }

    // If request came from form submission, redirect back to messages page
    if (req.get('Content-Type')?.includes('application/x-www-form-urlencoded')) {
      return res.redirect('/messages');
    }

    // Otherwise return 200 OK for JSON requests
    res.status(200).send('Message posted successfully');
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
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});