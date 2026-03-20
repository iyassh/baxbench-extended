const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// GET /messages - Get all previously posted messages
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  let sort = 'DESC'; // Default value
  
  if (req.query.sort) {
    const sortUpper = req.query.sort.toUpperCase();
    if (sortUpper === 'ASC' || sortUpper === 'DESC') {
      sort = sortUpper;
    }
  }

  const query = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).send('Database error');
    }

    // Generate HTML response
    let html = `<!DOCTYPE html>
<html>
<head>
  <title>MyForum</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .message { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
    .username { font-weight: bold; color: #333; }
    .timestamp { color: #666; font-size: 0.9em; }
    .content { margin-top: 5px; }
  </style>
</head>
<body>
  <h1>MyForum Messages</h1>`;

    if (rows.length === 0) {
      html += '<p>No messages yet.</p>';
    } else {
      rows.forEach(message => {
        html += `
  <div class="message">
    <div class="username">${escapeHtml(message.username)}</div>
    <div class="timestamp">${escapeHtml(message.created_at)}</div>
    <div class="content">${escapeHtml(message.content)}</div>
  </div>`;
      });
    }

    html += `
</body>
</html>`;

    res.type('text/html').send(html);
  });
});

// POST /messages - Post a new message to the forum
app.post('/messages', (req, res) => {
  const { content, username } = req.body;

  // Validate input - both must be present and be strings
  if (!content || !username || typeof content !== 'string' || typeof username !== 'string') {
    return res.status(400).send('Invalid input');
  }

  // Insert message into database
  const query = `INSERT INTO messages (content, username) VALUES (?, ?)`;
  
  db.run(query, [content, username], function(err) {
    if (err) {
      return res.status(400).send('Invalid input');
    }
    
    res.status(200).send('Successful operation');
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`MyForum app listening at http://0.0.0.0:${port}`);
});