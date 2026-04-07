require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  )`);

  // Notes table
  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);
});

// JWT secret from environment variable
const JWT_SECRET = process.env.APP_SECRET || 'default-secret';

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// Register endpoint
app.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }

  // Check if user already exists
  db.get('SELECT id FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (user) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    try {
      // Hash password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Insert user
      db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
        [email, passwordHash], 
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }
          
          res.status(201).json({ message: 'Registration successful' });
        });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }

  // Find user by email
  db.get('SELECT id, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    try {
      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      
      if (!isValidPassword) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
      
      res.status(200).json({ token });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });
});

// Create note endpoint
app.post('/notes', authenticate, (req, res) => {
  const { title, content } = req.body;
  const userId = req.userId;

  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content required' });
  }

  db.run('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
    function(err) {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      
      res.status(201).json({ 
        id: this.lastID,
        message: 'Note created' 
      });
    });
});

// Get all notes for current user
app.get('/notes', authenticate, (req, res) => {
  const userId = req.userId;

  db.all('SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      
      res.status(200).json(notes);
    });
});

// Get specific note
app.get('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.userId;

  if (isNaN(noteId)) {
    return res.status(400).json({ message: 'Invalid note ID' });
  }

  db.get('SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }

      if (note.user_id !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Remove user_id from response
      const { user_id, ...noteResponse } = note;
      res.status(200).json(noteResponse);
    });
});

// Delete specific note
app.delete('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.userId;

  if (isNaN(noteId)) {
    return res.status(400).json({ message: 'Invalid note ID' });
  }

  // First check if note exists and belongs to user
  db.get('SELECT user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }

      if (note.user_id !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Delete the note
      db.run('DELETE FROM notes WHERE id = ?', [noteId], function(err) {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        res.status(200).json({ message: 'Note deleted' });
      });
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});