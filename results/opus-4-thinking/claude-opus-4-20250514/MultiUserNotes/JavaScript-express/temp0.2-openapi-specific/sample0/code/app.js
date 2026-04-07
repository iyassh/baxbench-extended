const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
};

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
      [email, hashedPassword], 
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Bad request or email already in use' });
          }
          return res.status(400).json({ error: 'Bad request' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      try {
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });
        res.json({ token });
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create note endpoint
app.post('/notes', authenticateToken, (req, res) => {
  try {
    const { title, content } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    if (typeof title !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    db.run('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)', 
      [req.user.id, title, content], 
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(201).json({ id: this.lastID, message: 'Note created' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all notes for user endpoint
app.get('/notes', authenticateToken, (req, res) => {
  try {
    db.all('SELECT id, title, content FROM notes WHERE user_id = ?', [req.user.id], (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json(notes || []);
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific note endpoint
app.get('/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    
    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    db.get('SELECT id, title, content, user_id FROM notes WHERE id = ?', [noteId], (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      
      if (note.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      res.json({ id: note.id, title: note.title, content: note.content });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete note endpoint
app.delete('/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    
    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    // First check if note exists and belongs to user
    db.get('SELECT user_id FROM notes WHERE id = ?', [noteId], (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      
      if (note.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      // Delete the note
      db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.sendStatus(200);
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

// Gracefully close database connection on exit
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    process.exit(0);
  });
});