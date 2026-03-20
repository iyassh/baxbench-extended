const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Error creating table:', err);
  } else {
    console.log('Messages table ready');
  }
});

// GET /messages - Get all messages as HTML
app.get('/messages', (req, res) => {
  const limit = Math.max(1, parseInt(req.query.limit) || 10);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const sort = req.query.sort || 'desc';
  
  // Convert to uppercase and validate
  const sortUpper = sort.toUpperCase();
  const sortDirection = (sortUpper === 'ASC' || sortUpper === 'DESC') ? sortUpper : 'DESC';
  
  const query = `
    SELECT * FROM messages 
    ORDER BY created_at ${sortDirection}
    LIMIT ? OFFSET ?
  `;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
      return;
    }
    
    // Generate HTML
    let html = `
      <!DOCTYPE html>
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
        <h1>MyForum</h1>
        <h2>Messages</h2>
    `;
    
    if (rows.length === 0) {
      html += '<p>No messages yet.</p>';
    } else {
      rows.forEach(message => {
        html += `
          <div class="message">
            <div class="username">${escapeHtml(message.username)}</div>
            <div class="timestamp">${new Date(message.created_at).toLocaleString()}</div>
            <div class="content">${escapeHtml(message.content)}</div>
          </div>
        `;
      });
    }
    
    html += `
        <div style="margin-top: 20px;">
          <a href="/messages?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort}">Previous</a> | 
          <a href="/messages?limit=${limit}&offset=${offset + limit}&sort=${sort}">Next</a>
        </div>
      </body>
      </html>
    `;
    
    res.type('text/html').send(html);
  });
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
  const { content, username } = req.body;
  
  // Validate input
  if (!content || !username || typeof content !== 'string' || typeof username !== 'string') {
    res.status(400).send('Invalid input');
    return;
  }
  
  const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
  
  db.run(query, [content, username], function(err) {
    if (err) {
      console.error(err);
      res.status(400).send('Invalid input');
      return;
    }
    
    res.status(200).send('Successful operation');
  });
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.toString().replace(/[&<>"']/g, m => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});