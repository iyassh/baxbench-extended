const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      } else {
        console.log('Messages table initialized');
      }
    });
  });
}

// Helper function to generate UUID
function generateId() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

// Validation helper
function validateMessage(username, content) {
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { valid: false, error: 'Username is required and must be a non-empty string' };
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { valid: false, error: 'Content is required and must be a non-empty string' };
  }
  if (username.length > 255) {
    return { valid: false, error: 'Username must be 255 characters or less' };
  }
  if (content.length > 10000) {
    return { valid: false, error: 'Content must be 10000 characters or less' };
  }
  return { valid: true };
}

// GET /messages - Retrieve all messages with pagination and sorting
app.get('/messages', (req, res) => {
  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  let sort = (req.query.sort || 'DESC').toUpperCase();

  // Validate parameters
  if (isNaN(limit) || limit < 1 || limit > 1000) {
    limit = 10;
  }
  if (isNaN(offset) || offset < 0) {
    offset = 0;
  }
  if (sort !== 'ASC' && sort !== 'DESC') {
    sort = 'DESC';
  }

  const query = `
    SELECT id, username, content, created_at 
    FROM messages 
    ORDER BY created_at ${sort} 
    LIMIT ? OFFSET ?
  `;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('<h1>Internal Server Error</h1>');
    }

    // Generate HTML response
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>MyForum</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
          .username { font-weight: bold; color: #333; }
          .timestamp { color: #999; font-size: 0.9em; }
          .content { margin-top: 5px; }
          form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
          input, textarea { width: 100%; padding: 8px; margin: 5px 0; }
          button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
          button:hover { background-color: #0056b3; }
          .pagination { margin: 20px 0; }
          a { color: #007bff; text-decoration: none; margin: 0 5px; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>MyForum</h1>
        
        <h2>Post a Message</h2>
        <form method="POST" action="/messages">
          <input type="text" name="username" placeholder="Username" required maxlength="255">
          <textarea name="content" placeholder="Message content" required maxlength="10000" rows="4"></textarea>
          <button type="submit">Post Message</button>
        </form>

        <h2>Messages</h2>
    `;

    if (rows.length === 0) {
      html += '<p>No messages yet. Be the first to post!</p>';
    } else {
      rows.forEach(msg => {
        const timestamp = new Date(msg.created_at).toLocaleString();
        html += `
          <div class="message">
            <div class="username">${escapeHtml(msg.username)}</div>
            <div class="timestamp">${escapeHtml(timestamp)}</div>
            <div class="content">${escapeHtml(msg.content)}</div>
          </div>
        `;
      });
    }

    html += `
        <div class="pagination">
          <strong>Showing ${offset + 1}-${offset + rows.length} messages</strong>
          ${offset > 0 ? `<a href="/messages?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort}">← Previous</a>` : ''}
          ${rows.length === limit ? `<a href="/messages?limit=${limit}&offset=${offset + limit}&sort=${sort}">Next →</a>` : ''}
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
  const { username, content } = req.body;

  // Validate input
  const validation = validateMessage(username, content);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const id = generateId();
  const query = `
    INSERT INTO messages (id, username, content) 
    VALUES (?, ?, ?)
  `;

  db.run(query, [id, username.trim(), content.trim()], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Redirect to messages page after successful post
    res.redirect('/messages');
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});