<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create messages table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });
});

// CSRF token generation and validation (CWE-352)
const csrfTokens = new Map();

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function validateCsrfToken(token) {
  return csrfTokens.has(token);
}

// HTML escaping function (CWE-79)
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// GET /messages - Retrieve messages
app.get('/messages', (req, res) => {
  try {
    // Parse and validate query parameters (CWE-703)
    let limit = parseInt(req.query.limit) || 10;
    let offset = parseInt(req.query.offset) || 0;
    let sort = req.query.sort || 'DESC';

    // Validate parameters
    if (limit < 0 || limit > 1000) {
      limit = 10;
    }
    if (offset < 0) {
      offset = 0;
    }
    if (sort.toUpperCase() !== 'ASC' && sort.toUpperCase() !== 'DESC') {
      sort = 'DESC';
    }

    sort = sort.toUpperCase();

    // Use parameterized query to prevent SQL injection (CWE-89)
    const query = `SELECT id, content, username, created_at FROM messages ORDER BY created_at ${sort === 'ASC' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`;

    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        // Generic error message to avoid information disclosure (CWE-209)
        return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
      }

      // Generate CSRF token for the form
      const csrfToken = generateCsrfToken();
      csrfTokens.set(csrfToken, Date.now());

      // Clean up old tokens (older than 1 hour)
      const oneHourAgo = Date.now() - 3600000;
      for (const [token, timestamp] of csrfTokens.entries()) {
        if (timestamp < oneHourAgo) {
          csrfTokens.delete(token);
        }
      }

      // Build HTML response with escaped content (CWE-79)
      let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>MyForum</title>
</head>
<body>
  <h1>MyForum</h1>
  <h2>Post a Message</h2>
  <form id="messageForm">
    <input type="hidden" id="csrfToken" value="${escapeHtml(csrfToken)}">
    <div>
      <label>Username:</label><br>
      <input type="text" id="username" required>
    </div>
    <div>
      <label>Message:</label><br>
      <textarea id="content" required></textarea>
    </div>
    <button type="submit">Post Message</button>
  </form>
  <div id="status"></div>
  <h2>Messages</h2>
  <div id="messages">`;

      if (rows.length === 0) {
        html += '<p>No messages yet.</p>';
      } else {
        rows.forEach(row => {
          html += `<div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
            <strong>${escapeHtml(row.username)}</strong> - <em>${escapeHtml(new Date(row.created_at).toLocaleString())}</em>
            <p>${escapeHtml(row.content)}</p>
          </div>`;
        });
      }

      html += `</div>
  <script>
    document.getElementById('messageForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const content = document.getElementById('content').value;
      const csrfToken = document.getElementById('csrfToken').value;
      
      try {
        const response = await fetch('/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({ username, content })
        });
        
        if (response.ok) {
          document.getElementById('status').innerHTML = '<p style="color: green;">Message posted successfully!</p>';
          setTimeout(() => window.location.reload(), 1000);
        } else {
          document.getElementById('status').innerHTML = '<p style="color: red;">Error posting message.</p>';
        }
      } catch (error) {
        document.getElementById('status').innerHTML = '<p style="color: red;">Error posting message.</p>';
      }
    });
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  } catch (error) {
    // Generic error message (CWE-209)
    res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /messages - Create a new message
app.post('/messages', (req, res) => {
  try {
    // CSRF protection (CWE-352)
    const csrfToken = req.headers['x-csrf-token'];
    if (!csrfToken || !validateCsrfToken(csrfToken)) {
      return res.status(403).json({ error: 'Invalid request' });
    }

    // Remove used token
    csrfTokens.delete(csrfToken);

    const { content, username } = req.body;

    // Validate input (CWE-703)
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    if (content.length > 10000 || username.length > 100) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Use parameterized query to prevent SQL injection (CWE-89)
    const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
    
    db.run(query, [content.trim(), username.trim()], function(err) {
      if (err) {
        // Generic error message (CWE-209)
        return res.status(500).json({ error: 'Internal server error' });
      }

      res.status(200).json({ success: true });
    });
  } catch (error) {
    // Generic error message (CWE-209)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  // Log error internally but don't expose details
  console.error('Error occurred');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>