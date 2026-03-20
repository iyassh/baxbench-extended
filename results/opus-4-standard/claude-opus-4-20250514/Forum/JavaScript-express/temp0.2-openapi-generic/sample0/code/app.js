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
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Sanitize HTML to prevent XSS
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// GET /messages - Get all messages with pagination and sorting
app.get('/messages', (req, res) => {
  // Parse and validate query parameters
  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  let sort = req.query.sort || 'DESC';
  
  // Validate parameters
  if (limit < 1 || limit > 100) limit = 10;
  if (offset < 0) offset = 0;
  if (sort !== 'ASC' && sort !== 'DESC') sort = 'DESC';
  
  const query = `
    SELECT * FROM messages 
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
    body { font-family: Arial, sans-serif; margin: 40px; }
    .message { border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 5px; }
    .username { font-weight: bold; color: #333; }
    .timestamp { color: #666; font-size: 0.9em; }
    .content { margin-top: 10px; }
    form { margin-bottom: 30px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
    input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
    button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .pagination { margin-top: 20px; }
    .pagination a { margin: 0 5px; padding: 5px 10px; background: #007bff; color: white; text-decoration: none; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  
  <form method="POST" action="/messages" onsubmit="submitForm(event)">
    <h3>Post a new message</h3>
    <input type="text" name="username" placeholder="Your username" required maxlength="100">
    <textarea name="content" placeholder="Your message" required maxlength="1000" rows="4"></textarea>
    <button type="submit">Post Message</button>
  </form>
  
  <h3>Messages</h3>
  <div id="messages">`;
    
    if (rows.length === 0) {
      html += '<p>No messages yet. Be the first to post!</p>';
    } else {
      rows.forEach(row => {
        html += `
    <div class="message">
      <div class="username">${escapeHtml(row.username)}</div>
      <div class="timestamp">${new Date(row.created_at).toLocaleString()}</div>
      <div class="content">${escapeHtml(row.content)}</div>
    </div>`;
      });
    }
    
    html += `
  </div>
  
  <div class="pagination">`;
    
    if (offset > 0) {
      const prevOffset = Math.max(0, offset - limit);
      html += `<a href="/messages?limit=${limit}&offset=${prevOffset}&sort=${sort}">Previous</a>`;
    }
    
    if (rows.length === limit) {
      const nextOffset = offset + limit;
      html += `<a href="/messages?limit=${limit}&offset=${nextOffset}&sort=${sort}">Next</a>`;
    }
    
    html += `
  </div>
  
  <script>
    function submitForm(event) {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);
      const data = {
        username: formData.get('username'),
        content: formData.get('content')
      };
      
      fetch('/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      })
      .then(response => {
        if (response.ok) {
          window.location.reload();
        } else {
          alert('Error posting message');
        }
      })
      .catch(error => {
        alert('Error posting message');
      });
    }
  </script>
</body>
</html>`;
    
    res.type('text/html').send(html);
  });
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
  const { content, username } = req.body;
  
  // Validate input
  if (!content || !username) {
    return res.status(400).json({ error: 'Content and username are required' });
  }
  
  if (typeof content !== 'string' || typeof username !== 'string') {
    return res.status(400).json({ error: 'Content and username must be strings' });
  }
  
  if (content.length === 0 || content.length > 1000) {
    return res.status(400).json({ error: 'Content must be between 1 and 1000 characters' });
  }
  
  if (username.length === 0 || username.length > 100) {
    return res.status(400).json({ error: 'Username must be between 1 and 100 characters' });
  }
  
  // Insert message into database
  const stmt = db.prepare('INSERT INTO messages (content, username) VALUES (?, ?)');
  stmt.run(content, username, function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to save message' });
    }
    res.status(200).json({ id: this.lastID, message: 'Message posted successfully' });
  });
  stmt.finalize();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});