const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

// Create messages table if it doesn't exist
function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      username TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
      process.exit(1);
    } else {
      console.log('Messages table ready');
    }
  });
}

// Helper function to escape HTML and prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// GET /messages - Get all messages with pagination and sorting
app.get('/messages', (req, res) => {
  // Parse and validate limit
  let limit = 10;
  if (req.query.limit !== undefined) {
    limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit < 0) {
      return res.status(400).send('Invalid limit parameter');
    }
  }
  
  // Parse and validate offset
  let offset = 0;
  if (req.query.offset !== undefined) {
    offset = parseInt(req.query.offset);
    if (isNaN(offset) || offset < 0) {
      return res.status(400).send('Invalid offset parameter');
    }
  }
  
  // Parse and validate sort
  let sort = 'DESC';
  if (req.query.sort !== undefined) {
    sort = req.query.sort.toUpperCase();
    if (sort !== 'ASC' && sort !== 'DESC') {
      return res.status(400).send('Invalid sort parameter. Must be ASC or DESC');
    }
  }
  
  const query = `
    SELECT id, content, username, timestamp 
    FROM messages 
    ORDER BY timestamp ${sort}, id ${sort}
    LIMIT ? OFFSET ?
  `;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Error fetching messages:', err.message);
      return res.status(500).send('Error fetching messages');
    }
    
    // Generate HTML response
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum - Messages</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
        }
        .message {
            background-color: white;
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            color: #666;
            font-size: 0.9em;
        }
        .username {
            font-weight: bold;
            color: #007bff;
        }
        .timestamp {
            color: #999;
        }
        .content {
            color: #333;
            line-height: 1.5;
            word-wrap: break-word;
        }
        .no-messages {
            text-align: center;
            color: #999;
            padding: 40px;
        }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>
`;
    
    if (rows.length === 0) {
      html += '    <div class="no-messages">No messages found.</div>\n';
    } else {
      rows.forEach(row => {
        html += `    <div class="message">
        <div class="message-header">
            <span class="username">${escapeHtml(row.username)}</span>
            <span class="timestamp">${escapeHtml(row.timestamp)}</span>
        </div>
        <div class="content">${escapeHtml(row.content)}</div>
    </div>
`;
      });
    }
    
    html += `</body>
</html>
`;
    
    res.type('text/html').send(html);
  });
});

// POST /messages - Post a new message
app.post('/messages', (req, res) => {
  // Check if body exists and is an object
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  const { content, username } = req.body;
  
  // Validate input
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({ error: 'Content is required and must be a non-empty string' });
  }
  
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required and must be a non-empty string' });
  }
  
  // Insert message into database
  const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
  
  db.run(query, [content.trim(), username.trim()], function(err) {
    if (err) {
      console.error('Error inserting message:', err.message);
      return res.status(500).json({ error: 'Error saving message' });
    }
    
    res.status(200).json({ 
      success: true, 
      messageId: this.lastID 
    });
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});