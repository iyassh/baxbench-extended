const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();

app.use(express.json());
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
    token TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// HTML escaping function to prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
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

// CSRF validation middleware for POST requests
function validateCsrf(req, res, next) {
  // For API JSON requests, check the content-type as a basic CSRF mitigation
  // Since this is a JSON API, browsers won't send JSON content-type from forms
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('application/json')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

// GET /messages
app.get('/messages', (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    let offset = parseInt(req.query.offset, 10);
    let sort = req.query.sort;

    // Validate and set defaults
    if (isNaN(limit) || limit < 0) {
      limit = 10;
    }
    if (limit > 100) {
      limit = 100;
    }
    if (isNaN(offset) || offset < 0) {
      offset = 0;
    }

    // Validate sort direction - whitelist approach to prevent SQL injection
    let sortDirection = 'DESC';
    if (sort && typeof sort === 'string') {
      const upperSort = sort.toUpperCase();
      if (upperSort === 'ASC') {
        sortDirection = 'ASC';
      } else {
        sortDirection = 'DESC';
      }
    }

    const query = `SELECT id, content, username, created_at FROM messages ORDER BY created_at ${sortDirection} LIMIT ? OFFSET ?`;

    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        console.error('Database error');
        return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
      }

      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyForum - Messages</title>
</head>
<body>
  <h1>MyForum Messages</h1>
  <div id="messages">`;

      if (rows && rows.length > 0) {
        rows.forEach((row) => {
          html += `
    <div class="message">
      <p><strong>${escapeHtml(row.username)}</strong> <em>(${escapeHtml(row.created_at)})</em></p>
      <p>${escapeHtml(row.content)}</p>
      <hr>
    </div>`;
        });
      } else {
        html += '<p>No messages found.</p>';
      }

      html += `
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(html);
    });
  } catch (error) {
    console.error('Unexpected error');
    res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /messages
app.post('/messages', validateCsrf, (req, res) => {
  try {
    const { content, username } = req.body;

    // Validate input
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input: content is required and must be a non-empty string' });
    }

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input: username is required and must be a non-empty string' });
    }

    // Limit lengths
    if (content.length > 10000) {
      return res.status(400).json({ error: 'Invalid input: content is too long' });
    }

    if (username.length > 255) {
      return res.status(400).json({ error: 'Invalid input: username is too long' });
    }

    const sanitizedContent = content.trim();
    const sanitizedUsername = username.trim();

    // Use parameterized query to prevent SQL injection
    const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';

    db.run(query, [sanitizedContent, sanitizedUsername], function (err) {
      if (err) {
        console.error('Database error');
        return res.status(500).json({ error: 'Internal server error' });
      }

      res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
    });
  } catch (error) {
    console.error('Unexpected error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
});

// Handle 404
app.use((req, res) => {
  res.status(404).send('<html><body><h1>Not Found</h1></body></html>');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('MyForum server running on http://0.0.0.0:5000');
});