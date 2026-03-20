const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create messages table if it doesn't exist
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
      console.error('Error creating table:', err.message);
    }
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
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

// Helper function to validate message input
function validateMessage(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  if (!data.content || typeof data.content !== 'string') {
    return { valid: false, error: 'Content is required and must be a string' };
  }
  
  if (!data.username || typeof data.username !== 'string') {
    return { valid: false, error: 'Username is required and must be a string' };
  }
  
  if (data.content.trim().length === 0) {
    return { valid: false, error: 'Content cannot be empty' };
  }
  
  if (data.username.trim().length === 0) {
    return { valid: false, error: 'Username cannot be empty' };
  }
  
  if (data.content.length > 10000) {
    return { valid: false, error: 'Content is too long' };
  }
  
  if (data.username.length > 255) {
    return { valid: false, error: 'Username is too long' };
  }
  
  return { valid: true };
}

// GET /messages - Retrieve all messages
app.get('/messages', (req, res) => {
  try {
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
        console.error('Database error:', err.message);
        res.status(500).set('Content-Type', 'text/html').send('<html><body><h1>Internal Server Error</h1></body></html>');
        return;
      }
      
      // Generate HTML response
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>MyForum - Messages</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
            .username { font-weight: bold; color: #333; }
            .timestamp { color: #999; font-size: 0.9em; }
            .content { margin-top: 5px; }
            .form-container { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
            input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
            button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
            button:hover { background-color: #0056b3; }
          </style>
        </head>
        <body>
          <h1>MyForum</h1>
          
          <div class="form-container">
            <h2>Post a Message</h2>
            <form method="POST" action="/messages">
              <input type="text" name="username" placeholder="Username" required maxlength="255">
              <textarea name="content" placeholder="Message content" required maxlength="10000"></textarea>
              <button type="submit">Post Message</button>
            </form>
          </div>
          
          <h2>Messages</h2>
      `;
      
      if (rows.length === 0) {
        html += '<p>No messages yet. Be the first to post!</p>';
      } else {
        rows.forEach(row => {
          const escapedUsername = escapeHtml(row.username);
          const escapedContent = escapeHtml(row.content);
          const timestamp = new Date(row.created_at).toLocaleString();
          
          html += `
            <div class="message">
              <div class="username">${escapedUsername}</div>
              <div class="timestamp">${escapeHtml(timestamp)}</div>
              <div class="content">${escapedContent}</div>
            </div>
          `;
        });
      }
      
      html += `
          <div style="margin-top: 20px;">
            <a href="/messages?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort}">← Previous</a>
            <span> | </span>
            <a href="/messages?limit=${limit}&offset=${offset + limit}&sort=${sort}">Next →</a>
          </div>
        </body>
        </html>
      `;
      
      res.set('Content-Type', 'text/html').send(html);
    });
  } catch (err) {
    console.error('Error processing request:', err.message);
    res.status(500).set('Content-Type', 'text/html').send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /messages - Create a new message
app.post('/messages', express.urlencoded({ extended: true }), (req, res) => {
  try {
    const { username, content } = req.body;
    
    // Validate input
    const validation = validateMessage({ username, content });
    if (!validation.valid) {
      return res.status(400).set('Content-Type', 'text/html').send(`
        <html>
        <head><title>Error</title></head>
        <body>
          <h1>Bad Request</h1>
          <p>${escapeHtml(validation.error)}</p>
          <a href="/messages">Back to messages</a>
        </body>
        </html>
      `);
    }
    
    // Generate unique ID
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    
    // Insert into database using parameterized query to prevent SQL injection
    const query = 'INSERT INTO messages (id, username, content) VALUES (?, ?, ?)';
    db.run(query, [id, username.trim(), content.trim()], function(err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).set('Content-Type', 'text/html').send(`
          <html>
          <head><title>Error</title></head>
          <body>
            <h1>Internal Server Error</h1>
            <a href="/messages">Back to messages</a>
          </body>
          </html>
        `);
      }
      
      // Redirect to messages page
      res.redirect('/messages');
    });
  } catch (err) {
    console.error('Error processing request:', err.message);
    res.status(500).set('Content-Type', 'text/html').send(`
      <html>
      <head><title>Error</title></head>
      <body>
        <h1>Internal Server Error</h1>
        <a href="/messages">Back to messages</a>
      </body>
      </html>
    `);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).set('Content-Type', 'text/html').send('<html><body><h1>Internal Server Error</h1></body></html>');
});

// 404 handler
app.use((req, res) => {
  res.status(404).set('Content-Type', 'text/html').send('<html><body><h1>Not Found</h1></body></html>');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MyForum server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
});