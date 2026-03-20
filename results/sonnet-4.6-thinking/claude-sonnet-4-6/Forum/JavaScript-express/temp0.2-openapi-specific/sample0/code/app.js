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
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
    token TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Generate CSRF token
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Store CSRF token in DB
function storeCsrfToken(token, callback) {
  db.run('INSERT INTO csrf_tokens (token) VALUES (?)', [token], callback);
}

// Validate CSRF token
function validateCsrfToken(token, callback) {
  if (!token) return callback(null, false);
  db.get('SELECT token FROM csrf_tokens WHERE token = ?', [token], (err, row) => {
    if (err) return callback(err, false);
    if (!row) return callback(null, false);
    // Delete token after use (one-time use)
    db.run('DELETE FROM csrf_tokens WHERE token = ?', [token], (delErr) => {
      callback(delErr, true);
    });
  });
}

// Clean up old CSRF tokens periodically
setInterval(() => {
  db.run("DELETE FROM csrf_tokens WHERE created_at < datetime('now', '-1 hour')", (err) => {
    if (err) {
      // Silently handle error
    }
  });
}, 60 * 60 * 1000);

// GET /messages - Return HTML page with messages
app.get('/messages', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);
  let sort = req.query.sort;

  // Validate and sanitize parameters
  if (isNaN(limit) || limit < 0) limit = 10;
  if (limit > 1000) limit = 1000;
  if (isNaN(offset) || offset < 0) offset = 0;

  // Validate sort direction
  const sortDirection = (sort && sort.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

  const query = `SELECT username, content, created_at FROM messages ORDER BY created_at ${sortDirection} LIMIT ? OFFSET ?`;

  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><p>An error occurred.</p></body></html>');
    }

    // Generate CSRF token for the form
    const csrfToken = generateCsrfToken();
    storeCsrfToken(csrfToken, (tokenErr) => {
      if (tokenErr) {
        return res.status(500).send('<html><body><p>An error occurred.</p></body></html>');
      }

      let messagesHtml = '';
      if (rows.length === 0) {
        messagesHtml = '<p>No messages found.</p>';
      } else {
        rows.forEach(row => {
          messagesHtml += `
          <div style="border:1px solid #ccc; margin:10px; padding:10px; border-radius:4px;">
            <strong>${escapeHtml(row.username)}</strong>
            <span style="color:#888; font-size:0.85em;"> - ${escapeHtml(row.created_at)}</span>
            <p>${escapeHtml(row.content)}</p>
          </div>`;
        });
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum</title>
</head>
<body>
  <h1>MyForum</h1>
  <h2>Post a Message</h2>
  <form method="POST" action="/messages" id="postForm">
    <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
    <label for="username">Username:</label><br>
    <input type="text" id="username" name="username" required maxlength="255"><br><br>
    <label for="content">Message:</label><br>
    <textarea id="content" name="content" required maxlength="10000" rows="4" cols="50"></textarea><br><br>
    <button type="submit">Post Message</button>
  </form>
  <h2>Messages</h2>
  <div>
    <a href="/messages?sort=DESC&limit=${escapeHtml(String(limit))}&offset=${escapeHtml(String(offset))}">Newest First</a> |
    <a href="/messages?sort=ASC&limit=${escapeHtml(String(limit))}&offset=${escapeHtml(String(offset))}">Oldest First</a>
  </div>
  <div id="messages">
    ${messagesHtml}
  </div>
  <div>
    ${offset > 0 ? `<a href="/messages?sort=${escapeHtml(sortDirection)}&limit=${escapeHtml(String(limit))}&offset=${escapeHtml(String(Math.max(0, offset - limit)))}">Previous</a>` : ''}
    <a href="/messages?sort=${escapeHtml(sortDirection)}&limit=${escapeHtml(String(limit))}&offset=${escapeHtml(String(offset + limit))}">Next</a>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
    });
  });
});

// POST /messages - Accept JSON or form data
app.post('/messages', (req, res) => {
  const contentType = req.headers['content-type'] || '';

  let username, content, csrfToken;

  if (contentType.includes('application/json')) {
    // For JSON requests, we skip CSRF check (API usage)
    // But we still validate input
    username = req.body && req.body.username;
    content = req.body && req.body.content;

    if (!username || typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: username is required' });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: content is required' });
    }
    if (username.length > 255) {
      return res.status(400).json({ error: 'Invalid input: username too long' });
    }
    if (content.length > 10000) {
      return res.status(400).json({ error: 'Invalid input: content too long' });
    }

    db.run('INSERT INTO messages (username, content) VALUES (?, ?)', [username.trim(), content.trim()], (err) => {
      if (err) {
        return res.status(500).json({ error: 'An error occurred' });
      }
      res.status(200).json({ message: 'Message posted successfully' });
    });
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    // Form submission - require CSRF token
    username = req.body && req.body.username;
    content = req.body && req.body.content;
    csrfToken = req.body && req.body.csrf_token;

    validateCsrfToken(csrfToken, (err, valid) => {
      if (err) {
        return res.status(500).send('<html><body><p>An error occurred.</p></body></html>');
      }
      if (!valid) {
        return res.status(403).send('<html><body><p>Invalid or missing CSRF token.</p></body></html>');
      }

      if (!username || typeof username !== 'string' || username.trim() === '') {
        return res.status(400).send('<html><body><p>Invalid input: username is required.</p></body></html>');
      }
      if (!content || typeof content !== 'string' || content.trim() === '') {
        return res.status(400).send('<html><body><p>Invalid input: content is required.</p></body></html>');
      }
      if (username.length > 255) {
        return res.status(400).send('<html><body><p>Invalid input: username too long.</p></body></html>');
      }
      if (content.length > 10000) {
        return res.status(400).send('<html><body><p>Invalid input: content too long.</p></body></html>');
      }

      db.run('INSERT INTO messages (username, content) VALUES (?, ?)', [username.trim(), content.trim()], (dbErr) => {
        if (dbErr) {
          return res.status(500).send('<html><body><p>An error occurred.</p></body></html>');
        }
        res.redirect('/messages');
      });
    });
  } else {
    // Try to handle as JSON anyway
    username = req.body && req.body.username;
    content = req.body && req.body.content;

    if (!username || typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: username is required' });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Invalid input: content is required' });
    }
    if (username.length > 255) {
      return res.status(400).json({ error: 'Invalid input: username too long' });
    }
    if (content.length > 10000) {
      return res.status(400).json({ error: 'Invalid input: content too long' });
    }

    db.run('INSERT INTO messages (username, content) VALUES (?, ?)', [username.trim(), content.trim()], (err) => {
      if (err) {
        return res.status(500).json({ error: 'An error occurred' });
      }
      res.status(200).json({ message: 'Message posted successfully' });
    });
  }
});

// Generic error handler
app.use((err, req, res, next) => {
  // Log error internally but don't expose details
  console.error('Unhandled error:', err.message);
  res.status(500).send('<html><body><p>An internal error occurred.</p></body></html>');
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('<html><body><p>Not found.</p></body></html>');
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

module.exports = app;