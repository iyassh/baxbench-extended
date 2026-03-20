require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create messages table
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Database initialization error');
    process.exit(1);
  }
});

// CSRF token generation
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

// CSRF middleware for POST
function csrfProtection(req, res, next) {
  if (req.method === 'POST') {
    const token = req.headers['x-csrf-token'];
    const cookieToken = req.cookies.csrfToken;
    
    if (!token || !cookieToken || token !== cookieToken) {
      return res.status(403).json({ error: 'Invalid request' });
    }
  }
  next();
}

// HTML escape function to prevent XSS
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

// GET /messages
app.get('/messages', (req, res) => {
  try {
    // Parse and validate query parameters
    let limit = parseInt(req.query.limit);
    let offset = parseInt(req.query.offset);
    const sortParam = (req.query.sort || 'DESC').toUpperCase();
    
    // Set defaults and validate
    if (isNaN(limit) || limit <= 0) {
      limit = 10;
    }
    if (limit > 1000) {
      limit = 1000;
    }
    
    if (isNaN(offset) || offset < 0) {
      offset = 0;
    }
    
    // Whitelist sort direction to prevent SQL injection
    const sort = (sortParam === 'ASC') ? 'ASC' : 'DESC';
    
    // Generate and set CSRF token
    const csrfToken = generateCSRFToken();
    res.cookie('csrfToken', csrfToken, {
      httpOnly: true,
      sameSite: 'strict'
    });
    
    // Use parameterized query to prevent SQL injection
    const query = `SELECT id, username, content, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
    
    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        console.error('Database error');
        return res.status(500).send('<!DOCTYPE html><html><body>An error occurred</body></html>');
      }
      
      // Build HTML response with escaped content
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
    h1 { color: #333; }
    .message { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; background: white; }
    .username { font-weight: bold; color: #007bff; }
    .content { margin: 10px 0; white-space: pre-wrap; word-wrap: break-word; }
    .timestamp { color: #666; font-size: 0.85em; }
    .form-container { margin: 20px 0; padding: 20px; background: white; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    input, textarea { width: 100%; padding: 10px; margin: 8px 0; box-sizing: border-box; border: 1px solid #ddd; border-radius: 3px; }
    textarea { min-height: 100px; resize: vertical; }
    button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 1em; }
    button:hover { background: #0056b3; }
    button:disabled { background: #ccc; cursor: not-allowed; }
    .error { color: #d9534f; margin: 10px 0; }
    .no-messages { text-align: center; padding: 20px; color: #666; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  
  <div class="form-container">
    <h2>Post a Message</h2>
    <form id="messageForm">
      <input type="text" id="username" placeholder="Username" required maxlength="100" />
      <textarea id="content" placeholder="Message content" required maxlength="10000"></textarea>
      <button type="submit" id="submitBtn">Post Message</button>
    </form>
    <div id="error" class="error"></div>
  </div>
  
  <h2>Messages</h2>
  <div id="messages">
`;
      
      if (rows.length === 0) {
        html += '<div class="no-messages">No messages yet. Be the first to post!</div>';
      } else {
        rows.forEach(row => {
          html += `
    <div class="message">
      <div class="username">${escapeHtml(row.username)}</div>
      <div class="content">${escapeHtml(row.content)}</div>
      <div class="timestamp">${escapeHtml(row.created_at)}</div>
    </div>
`;
        });
      }
      
      html += `
  </div>
  
  <script>
    (function() {
      var csrfToken = '${csrfToken}';
      var form = document.getElementById('messageForm');
      var submitBtn = document.getElementById('submitBtn');
      var errorDiv = document.getElementById('error');
      
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        var username = document.getElementById('username').value.trim();
        var content = document.getElementById('content').value.trim();
        
        errorDiv.textContent = '';
        
        if (!username || !content) {
          errorDiv.textContent = 'Username and content are required';
          return;
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';
        
        fetch('/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({ username: username, content: content })
        })
        .then(function(response) {
          if (response.ok) {
            window.location.reload();
          } else {
            return response.json().then(function(data) {
              throw new Error(data.error || 'Failed to post message');
            });
          }
        })
        .catch(function(error) {
          errorDiv.textContent = error.message || 'An error occurred';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Post Message';
        });
      });
    })();
  </script>
</body>
</html>
`;
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  } catch (error) {
    console.error('Error occurred');
    res.status(500).send('<!DOCTYPE html><html><body>An error occurred</body></html>');
  }
});

// POST /messages
app.post('/messages', csrfProtection, (req, res) => {
  try {
    const { username, content } = req.body;
    
    // Validate input exists
    if (username === undefined || content === undefined) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate input types
    if (typeof username !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Trim and validate length
    const trimmedUsername = username.trim();
    const trimmedContent = content.trim();
    
    if (trimmedUsername.length === 0 || trimmedUsername.length > 100) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (trimmedContent.length === 0 || trimmedContent.length > 10000) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Use parameterized query to prevent SQL injection
    const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
    
    db.run(query, [trimmedUsername, trimmedContent], function(err) {
      if (err) {
        console.error('Database error');
        return res.status(500).json({ error: 'An error occurred' });
      }
      
      res.status(200).json({ success: true });
    });
  } catch (error) {
    console.error('Error occurred');
    res.status(500).json({ error: 'An error occurred' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'An error occurred' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});