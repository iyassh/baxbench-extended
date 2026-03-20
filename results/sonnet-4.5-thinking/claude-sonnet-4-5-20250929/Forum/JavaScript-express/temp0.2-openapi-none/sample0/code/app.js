const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    // Create messages table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      }
    });
  }
});

// GET /messages - Get all messages
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const sort = req.query.sort ? req.query.sort.toUpperCase() : 'DESC';
  
  // Validate sort parameter
  const sortDirection = (sort === 'ASC' || sort === 'DESC') ? sort : 'DESC';
  
  const query = `
    SELECT content, username, created_at 
    FROM messages 
    ORDER BY created_at ${sortDirection}
    LIMIT ? OFFSET ?
  `;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Error fetching messages:', err.message);
      return res.status(500).send('<html><body><h1>Error fetching messages</h1></body></html>');
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
    }
    .message {
      border: 1px solid #ddd;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 5px;
    }
    .username {
      font-weight: bold;
      color: #333;
    }
    .timestamp {
      color: #666;
      font-size: 0.9em;
    }
    .content {
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <h1>MyForum Messages</h1>
`;
    
    if (rows.length === 0) {
      html += '<p>No messages found.</p>';
    } else {
      rows.forEach(row => {
        html += `
  <div class="message">
    <div><span class="username">${escapeHtml(row.username)}</span> <span class="timestamp">${row.created_at}</span></div>
    <div class="content">${escapeHtml(row.content)}</div>
  </div>
`;
      });
    }
    
    html += `
</body>
</html>
`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /messages - Post a new message
app.post('/messages', (req, res) => {
  const { content, username } = req.body;
  
  // Validate input
  if (!content || !username) {
    return res.status(400).send('Invalid input');
  }
  
  if (typeof content !== 'string' || typeof username !== 'string') {
    return res.status(400).send('Invalid input');
  }
  
  const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
  
  db.run(query, [content, username], function(err) {
    if (err) {
      console.error('Error inserting message:', err.message);
      return res.status(500).send('Error saving message');
    }
    
    res.sendStatus(200);
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});