require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create messages table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Function to escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// GET /messages endpoint
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const sort = (req.query.sort && req.query.sort.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
  
  // Validate parameters
  if (limit < 1 || limit > 1000) {
    return res.status(400).send('Invalid limit parameter');
  }
  if (offset < 0) {
    return res.status(400).send('Invalid offset parameter');
  }
  
  const query = `SELECT * FROM messages ORDER BY created_at ${sort} LIMIT ? OFFSET ?`;
  
  db.all(query, [limit, offset], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal server error');
    }
    
    // Generate HTML response
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { 
            font-family: Arial, sans-serif; 
            margin: 20px; 
            background-color: #f5f5f5; 
        }
        .container { 
            max-width: 800px; 
            margin: 0 auto; 
            background-color: white; 
            padding: 20px; 
            border-radius: 10px; 
            box-shadow: 0 2px 5px rgba(0,0,0,0.1); 
        }
        h1 { 
            color: #333; 
            text-align: center; 
            margin-bottom: 30px; 
        }
        .message { 
            border: 1px solid #ddd; 
            margin: 15px 0; 
            padding: 15px; 
            border-radius: 8px; 
            background-color: #fafafa; 
        }
        .message-header { 
            font-weight: bold; 
            color: #666; 
            font-size: 0.9em; 
            margin-bottom: 8px; 
        }
        .message-content { 
            line-height: 1.4; 
            color: #333; 
        }
        .post-form { 
            margin: 30px 0; 
            padding: 25px; 
            border: 2px solid #007bff; 
            border-radius: 8px; 
            background-color: #f8f9fa; 
        }
        .post-form h3 { 
            margin-top: 0; 
            color: #007bff; 
        }
        .post-form input, .post-form textarea { 
            width: 100%; 
            margin: 10px 0; 
            padding: 10px; 
            border: 1px solid #ccc; 
            border-radius: 5px; 
            font-size: 14px; 
            box-sizing: border-box; 
        }
        .post-form button { 
            background: #007bff; 
            color: white; 
            padding: 10px 20px; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer; 
            font-size: 16px; 
        }
        .post-form button:hover { 
            background: #0056b3; 
        }
        .post-form button:disabled { 
            background: #6c757d; 
            cursor: not-allowed; 
        }
        .pagination { 
            margin: 20px 0; 
            text-align: center; 
        }
        .pagination a { 
            margin: 0 5px; 
            padding: 8px 12px; 
            text-decoration: none; 
            border: 1px solid #ddd; 
            border-radius: 3px; 
            color: #007bff; 
        }
        .pagination a:hover { 
            background-color: #e9ecef; 
        }
        .no-messages { 
            text-align: center; 
            color: #666; 
            font-style: italic; 
            margin: 40px 0; 
        }
        .error { 
            color: red; 
            margin: 10px 0; 
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>MyForum</h1>
        
        <div class="post-form">
            <h3>Post a New Message</h3>
            <div id="error-message" class="error" style="display: none;"></div>
            <form id="messageForm">
                <input type="text" id="username" placeholder="Username" required maxlength="100">
                <textarea id="content" placeholder="Message content" rows="4" required maxlength="5000"></textarea>
                <button type="submit" id="submitBtn">Post Message</button>
            </form>
        </div>
        
        <h2>Messages</h2>
        <div class="pagination">
            <a href="?sort=DESC&limit=${limit}&offset=${offset}">Newest First</a>
            <a href="?sort=ASC&limit=${limit}&offset=${offset}">Oldest First</a>
            |`;
    
    if (offset > 0) {
      html += `<a href="?limit=${limit}&offset=${Math.max(0, offset - limit)}&sort=${sort}">Previous</a>`;
    }
    
    html += `<a href="?limit=${limit}&offset=${offset + limit}&sort=${sort}">Next</a>
        </div>`;
    
    if (rows.length === 0) {
      html += '<div class="no-messages">No messages yet. Be the first to post!</div>';
    } else {
      rows.forEach(row => {
        html += `
        <div class="message">
            <div class="message-header">
                ${escapeHtml(row.username)} - ${new Date(row.created_at).toLocaleString()}
            </div>
            <div class="message-content">
                ${escapeHtml(row.content).replace(/\n/g, '<br>')}
            </div>
        </div>`;
      });
    }
    
    html += `
    </div>
    
    <script>
        document.getElementById('messageForm').onsubmit = function(e) {
            e.preventDefault();
            
            const submitBtn = document.getElementById('submitBtn');
            const errorDiv = document.getElementById('error-message');
            const username = document.getElementById('username').value.trim();
            const content = document.getElementById('content').value.trim();
            
            // Clear previous errors
            errorDiv.style.display = 'none';
            
            // Basic validation
            if (!username || !content) {
                errorDiv.textContent = 'Username and content are required';
                errorDiv.style.display = 'block';
                return;
            }
            
            // Disable submit button during request
            submitBtn.disabled = true;
            submitBtn.textContent = 'Posting...';
            
            fetch('/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, content })
            })
            .then(response => {
                if (response.ok) {
                    location.reload();
                } else {
                    return response.json().then(data => {
                        throw new Error(data.error || 'Error posting message');
                    });
                }
            })
            .catch(error => {
                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post Message';
            });
        };
    </script>
</body>
</html>`;
    
    res.type('text/html').send(html);
  });
});

// POST /messages endpoint
app.post('/messages', (req, res) => {
  const { content, username } = req.body;
  
  // Validate input
  if (!content || !username) {
    return res.status(400).json({ error: 'Content and username are required' });
  }
  
  if (typeof content !== 'string' || typeof username !== 'string') {
    return res.status(400).json({ error: 'Content and username must be strings' });
  }
  
  const trimmedContent = content.trim();
  const trimmedUsername = username.trim();
  
  if (trimmedContent.length === 0 || trimmedUsername.length === 0) {
    return res.status(400).json({ error: 'Content and username cannot be empty' });
  }
  
  if (trimmedContent.length > 5000 || trimmedUsername.length > 100) {
    return res.status(400).json({ error: 'Content or username too long' });
  }
  
  const query = 'INSERT INTO messages (content, username) VALUES (?, ?)';
  
  db.run(query, [trimmedContent, trimmedUsername], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Message posted successfully',
      id: this.lastID 
    });
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`MyForum server running at http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
  });
  process.exit(0);
});