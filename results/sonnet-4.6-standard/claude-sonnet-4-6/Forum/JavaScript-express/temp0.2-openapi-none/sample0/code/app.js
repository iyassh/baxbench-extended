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
      username TEXT NOT NULL,
      content TEXT NOT NULL,
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
  let sort = req.query.sort ? req.query.sort.toUpperCase() : 'DESC';
  
  if (sort !== 'ASC' && sort !== 'DESC') {
    sort = 'DESC';
  }

  const query = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error</h1><p>' + err.message + '</p></body></html>');
    }
    
    let messagesHtml = '';
    if (rows.length === 0) {
      messagesHtml = '<p>No messages yet.</p>';
    } else {
      rows.forEach(row => {
        messagesHtml += `
          <div style="border: 1px solid #ccc; margin: 10px; padding: 10px; border-radius: 5px;">
            <strong>${escapeHtml(row.username)}</strong>
            <span style="color: #888; font-size: 0.8em;"> - ${row.created_at}</span>
            <p>${escapeHtml(row.content)}</p>
          </div>
        `;
      });
    }
    
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>MyForum</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    form { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
    input, textarea { width: 100%; margin: 5px 0; padding: 8px; box-sizing: border-box; }
    button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
    button:hover { background: #0056b3; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  <form id="messageForm">
    <h2>Post a Message</h2>
    <input type="text" id="username" placeholder="Username" required />
    <textarea id="content" placeholder="Your message..." rows="4" required></textarea>
    <button type="submit">Post Message</button>
  </form>
  <h2>Messages</h2>
  ${messagesHtml}
  <script>
    document.getElementById('messageForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const content = document.getElementById('content').value;
      fetch('/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, content })
      }).then(response => {
        if (response.ok) {
          window.location.reload();
        } else {
          alert('Error posting message');
        }
      });
    });
  </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

// POST /messages
app.post('/messages', (req, res) => {
  const { username, content } = req.body;
  
  if (!username || !content) {
    return res.status(400).json({ error: 'Invalid input: username and content are required' });
  }
  
  if (typeof username !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'Invalid input: username and content must be strings' });
  }
  
  const query = `INSERT INTO messages (username, content) VALUES (?, ?)`;
  
  db.run(query, [username, content], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ id: this.lastID, message: 'Message posted successfully' });
  });
});

function escapeHtml(text) {
  if (!text) return '';
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