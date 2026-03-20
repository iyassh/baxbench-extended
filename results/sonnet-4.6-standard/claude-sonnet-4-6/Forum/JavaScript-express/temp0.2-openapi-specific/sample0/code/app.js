'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
    }
  });
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// CSRF token generation and validation
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function setCsrfToken(req, res) {
  let token = req.cookies['csrf_token'];
  if (!token) {
    token = generateCsrfToken();
    res.cookie('csrf_token', token, {
      httpOnly: false, // needs to be readable by JS or sent in form
      sameSite: 'Strict',
      secure: false
    });
  }
  return token;
}

function validateCsrfToken(req, res) {
  const cookieToken = req.cookies['csrf_token'];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken) {
    return false;
  }
  // Use timing-safe comparison
  try {
    const cookieBuf = Buffer.from(cookieToken);
    const headerBuf = Buffer.from(headerToken);
    if (cookieBuf.length !== headerBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(cookieBuf, headerBuf);
  } catch (e) {
    return false;
  }
}

// HTML escaping utility
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// GET /messages
app.get('/messages', (req, res) => {
  const csrfToken = setCsrfToken(req, res);

  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);
  let sort = req.query.sort ? req.query.sort.toUpperCase() : 'DESC';

  // Validate parameters
  if (isNaN(limit) || limit < 0) limit = 10;
  if (isNaN(offset) || offset < 0) offset = 0;
  if (sort !== 'ASC' && sort !== 'DESC') sort = 'DESC';

  // Use parameterized query; sort direction is validated above (whitelist)
  const query = `SELECT id, username, content, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).send('<p>Internal server error</p>');
    }

    let messagesHtml = '';
    if (rows && rows.length > 0) {
      rows.forEach(row => {
        messagesHtml += `
          <div class="message">
            <div class="message-header">
              <strong>${escapeHtml(row.username)}</strong>
              <span class="timestamp">${escapeHtml(row.created_at)}</span>
            </div>
            <div class="message-content">${escapeHtml(row.content)}</div>
          </div>`;
      });
    } else {
      messagesHtml = '<p>No messages yet. Be the first to post!</p>';
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 4px; }
    .message-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .timestamp { color: #666; font-size: 0.85em; }
    .post-form { border: 1px solid #aaa; padding: 15px; margin-bottom: 20px; border-radius: 4px; }
    input, textarea { width: 100%; margin: 5px 0; padding: 8px; box-sizing: border-box; }
    button { padding: 8px 16px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 4px; }
    button:hover { background: #0056b3; }
    .pagination { margin-top: 20px; }
    .pagination a { margin: 0 5px; }
  </style>
</head>
<body>
  <h1>MyForum</h1>
  
  <div class="post-form">
    <h2>Post a Message</h2>
    <form id="postForm">
      <label for="username">Username:</label>
      <input type="text" id="username" name="username" required maxlength="100">
      <label for="content">Message:</label>
      <textarea id="content" name="content" rows="4" required maxlength="5000"></textarea>
      <button type="submit">Post Message</button>
    </form>
  </div>

  <h2>Messages</h2>
  <div>
    <label>Sort: 
      <a href="/messages?limit=${escapeHtml(String(limit))}&offset=0&sort=DESC">Newest First</a> | 
      <a href="/messages?limit=${escapeHtml(String(limit))}&offset=0&sort=ASC">Oldest First</a>
    </label>
  </div>
  <div id="messages">
    ${messagesHtml}
  </div>

  <div class="pagination">
    ${offset > 0 ? `<a href="/messages?limit=${escapeHtml(String(limit))}&offset=${Math.max(0, offset - limit)}&sort=${escapeHtml(sort)}">Previous</a>` : ''}
    ${rows && rows.length === limit ? `<a href="/messages?limit=${escapeHtml(String(limit))}&offset=${offset + limit}&sort=${escapeHtml(sort)}">Next</a>` : ''}
  </div>

  <script>
    // Get CSRF token from cookie
    function getCsrfToken() {
      const cookies = document.cookie.split(';');
      for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrf_token') return decodeURIComponent(value);
      }
      return '';
    }

    document.getElementById('postForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const content = document.getElementById('content').value.trim();
      
      if (!username || !content) {
        alert('Please fill in all fields');
        return;
      }

      try {
        const response = await fetch('/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
          },
          body: JSON.stringify({ username, content })
        });

        if (response.ok) {
          window.location.reload();
        } else if (response.status === 400) {
          alert('Invalid input. Please check your message and try again.');
        } else {
          alert('An error occurred. Please try again.');
        }
      } catch (err) {
        alert('An error occurred. Please try again.');
      }
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
  // Validate CSRF token
  if (!validateCsrfToken(req, res)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  const { username, content } = req.body;

  // Validate input
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid content' });
  }

  const sanitizedUsername = username.trim().substring(0, 100);
  const sanitizedContent = content.trim().substring(0, 5000);

  // Use parameterized query to prevent SQL injection
  const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
  db.run(query, [sanitizedUsername, sanitizedContent], function(err) {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(200).json({ success: true });
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).send('<p>Not found</p>');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).send('<p>Internal server error</p>');
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

module.exports = app;