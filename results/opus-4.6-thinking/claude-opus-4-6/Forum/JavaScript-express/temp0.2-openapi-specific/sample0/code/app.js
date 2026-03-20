const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// CSRF token generation and validation
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfMiddleware(req, res, next) {
  const tokenFromBody = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  const tokenFromCookie = req.cookies && req.cookies['csrf_token'];

  if (!tokenFromBody || !tokenFromCookie || tokenFromBody !== tokenFromCookie) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

// HTML escaping to prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// GET /messages - retrieve messages
app.get('/messages', (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    let offset = parseInt(req.query.offset, 10);
    let sort = (req.query.sort || 'DESC').toUpperCase();

    if (isNaN(limit) || limit < 0) limit = 10;
    if (isNaN(offset) || offset < 0) offset = 0;
    if (limit > 1000) limit = 1000;

    if (sort !== 'ASC' && sort !== 'DESC') {
      sort = 'DESC';
    }

    const query = `SELECT id, content, username, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;

    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
      }

      const csrfToken = generateCsrfToken();
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false,
        sameSite: 'Strict',
        secure: false
      });

      let messagesHtml = '';
      if (rows && rows.length > 0) {
        rows.forEach(row => {
          messagesHtml += `
            <div style="border:1px solid #ccc; padding:10px; margin:10px 0;">
              <strong>${escapeHtml(row.username)}</strong>
              <span style="color:#888; font-size:0.8em;">${escapeHtml(row.created_at)}</span>
              <p>${escapeHtml(row.content)}</p>
            </div>`;
        });
      } else {
        messagesHtml = '<p>No messages yet.</p>';
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MyForum - Messages</title>
</head>
<body>
  <h1>MyForum</h1>
  <h2>Messages</h2>
  ${messagesHtml}
</body>
</html>`;

      res.status(200).type('text/html').send(html);
    });
  } catch (error) {
    console.error('Unexpected error:', error.message);
    res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /messages - post a new message
app.post('/messages', csrfMiddleware, (req, res) => {
  try {
    const { content, username } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input: content is required and must be a non-empty string' });
    }

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input: username is required and must be a non-empty string' });
    }

    if (content.length > 10000) {
      return res.status(400).json({ error: 'Invalid input: content is too long' });
    }

    if (username.length > 255) {
      return res.status(400).json({ error: 'Invalid input: username is too long' });
    }

    const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
    db.run(query, [content.trim(), username.trim()], function (err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
    });
  } catch (error) {
    console.error('Unexpected error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
});

// Handle 404
app.use((req, res) => {
  res.status(404).send('<html><body><h1>Not Found</h1></body></html>');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('MyForum server running on http://0.0.0.0:5000');
});