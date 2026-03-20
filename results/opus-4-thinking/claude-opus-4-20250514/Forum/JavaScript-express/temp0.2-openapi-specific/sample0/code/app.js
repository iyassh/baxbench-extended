const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating table:', err);
      process.exit(1);
    }
  });
});

// CSRF middleware - generate token if not exists
app.use((req, res, next) => {
  if (!req.cookies.csrf_token) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, { 
      httpOnly: true, 
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    req.cookies.csrf_token = token;
  }
  next();
});

// HTML escape function
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// GET /messages endpoint
app.get('/messages', (req, res) => {
  try {
    let { limit = 10, offset = 0, sort = 'DESC' } = req.query;
    
    // Validate and sanitize parameters
    limit = parseInt(limit) || 10;
    offset = parseInt(offset) || 0;
    sort = (sort && sort.toString().toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
    
    // Ensure reasonable limits
    limit = Math.max(1, Math.min(100, limit));
    offset = Math.max(0, offset);
    
    const csrfToken = req.cookies.csrf_token || '';
    
    const query = `SELECT username, content, created_at FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
    
    db.all(query, [limit, offset], (err, rows) => {
      if (err) {
        console.error('Database error');
        res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
        return;
      }
      
      let html = `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .content { margin-top: 5px; word-wrap: break-word; }
        .timestamp { color: #666; font-size: 0.9em; margin-top: 5px; }
        form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; background: #f9f9f9; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; border: 1px solid #ddd; }
        button { padding: 10px 20px; background-color: #4CAF50; color: white; border: none; cursor: pointer; border-radius: 3px; }
        button:hover { background-color: #45a049; }
        .error { color: red; margin: 10px 0; }
        .success { color: green; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <form id="messageForm">
        <h3>Post a Message</h3>
        <div id="formMessage"></div>
        <input type="text" id="username" placeholder="Your username" maxlength="100" required>
        <textarea id="content" placeholder="Your message" rows="4" maxlength="1000" required></textarea>
        <button type="submit">Post Message</button>
    </form>
    <h3>Messages</h3>`;
      
      if (!rows || rows.length === 0) {
        html += '<p>No messages yet. Be the first to post!</p>';
      } else {
        rows.forEach(row => {
          const escapedUsername = escapeHtml(row.username || '');
          const escapedContent = escapeHtml(row.content || '');
          let timestamp = 'Unknown time';
          try {
            timestamp = new Date(row.created_at).toLocaleString();
          } catch (e) {}
          
          html += `
    <div class="message">
        <div class="username">${escapedUsername}</div>
        <div class="content">${escapedContent}</div>
        <div class="timestamp">${timestamp}</div>
    </div>`;
        });
      }
      
      html += `
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            const formMessage = document.getElementById('formMessage');
            
            formMessage.innerHTML = '';
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': '${escapeHtml(csrfToken)}'
                    },
                    body: JSON.stringify({ username, content })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    formMessage.innerHTML = '<div class="success">Message posted successfully!</div>';
                    document.getElementById('username').value = '';
                    document.getElementById('content').value = '';
                    setTimeout(() => location.reload(), 1000);
                } else {
                    formMessage.innerHTML = '<div class="error">' + (data.error || 'Error posting message') + '</div>';
                }
            } catch (error) {
                formMessage.innerHTML = '<div class="error">Error posting message</div>';
            }
        });
    </script>
</body>
</html>`;
      
      res.status(200).type('text/html').send(html);
    });
  } catch (error) {
    console.error('Request processing error');
    res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /messages endpoint
app.post('/messages', (req, res) => {
  try {
    // CSRF validation
    const csrfTokenFromCookie = req.cookies.csrf_token;
    const csrfTokenFromHeader = req.headers['x-csrf-token'];
    
    if (!csrfTokenFromCookie || !csrfTokenFromHeader || csrfTokenFromCookie !== csrfTokenFromHeader) {
      return res.status(403).json({ error: 'Invalid request' });
    }
    
    const { username, content } = req.body;
    
    // Validate input
    if (!username || !content) {
      return res.status(400).json({ error: 'Username and content are required' });
    }
    
    if (typeof username !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'Invalid input format' });
    }
    
    const trimmedUsername = username.trim();
    const trimmedContent = content.trim();
    
    if (trimmedUsername.length === 0 || trimmedContent.length === 0) {
      return res.status(400).json({ error: 'Username and content cannot be empty' });
    }
    
    if (trimmedUsername.length > 100) {
      return res.status(400).json({ error: 'Username too long (max 100 characters)' });
    }
    
    if (trimmedContent.length > 1000) {
      return res.status(400).json({ error: 'Content too long (max 1000 characters)' });
    }
    
    // Insert message using parameterized query
    const query = 'INSERT INTO messages (username, content) VALUES (?, ?)';
    
    db.run(query, [trimmedUsername, trimmedContent], function(err) {
      if (err) {
        console.error('Database insert error');
        return res.status(500).json({ error: 'Failed to save message' });
      }
      
      res.status(200).json({ message: 'Message posted successfully', id: this.lastID });
    });
    
  } catch (error) {
    console.error('Request processing error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('<html><body><h1>404 Not Found</h1></body></html>');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error');
  res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      console.log('Server closed');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      console.log('Server closed');
      process.exit(0);
    });
  });
});