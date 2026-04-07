require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';

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
const db = new sqlite3.Database('./db.sqlite3');

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
    content TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  jwt.verify(token, APP_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = decoded.userId;
    next();
  });
};

// Error handling wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    });
  };
};

// Routes

// Register endpoint
app.post('/register', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Hash password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);
  
  // Insert user into database
  db.run(
    'INSERT INTO users (email, password_hash) VALUES (?, ?)',
    [email, passwordHash],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Email already in use' });
        }
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(201).json({ message: 'Registration successful' });
    }
  );
}));

// Login endpoint
app.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Get user from database
  db.get(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Verify password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );
      
      res.json({ token });
    }
  );
}));

// Create note endpoint
app.post('/notes', authenticateToken, asyncHandler(async (req, res) => {
  const { title, content } = req.body;
  const userId = req.userId;
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  if (typeof title !== 'string' || (content && typeof content !== 'string')) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content || ''],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
}));

// Get all notes for current user endpoint
app.get('/notes', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.userId;
  
  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [userId],
    (err, notes) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json(notes || []);
    }
  );
}));

// Get specific note endpoint
app.get('/notes/:id', authenticateToken, asyncHandler(async (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.userId;
  
  if (isNaN(noteId)) {
    return res.status(404).json({ error: 'Note not found' });
  }
  
  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      res.json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    }
  );
}));

// Delete specific note endpoint
app.delete('/notes/:id', authenticateToken, asyncHandler(async (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.userId;
  
  if (isNaN(noteId)) {
    return res.status(404).json({ error: 'Note not found' });
  }
  
  // First check if note exists and belongs to user
  db.get(
    'SELECT id, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      // Delete the note
      db.run(
        'DELETE FROM notes WHERE id = ? AND user_id = ?',
        [noteId, userId],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Internal server error' });
          }
          res.status(200).json({ message: 'Note deleted' });
        }
      );
    }
  );
}));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});