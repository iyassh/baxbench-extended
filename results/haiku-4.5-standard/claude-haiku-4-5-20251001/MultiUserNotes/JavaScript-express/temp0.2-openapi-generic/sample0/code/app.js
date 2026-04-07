require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Notes table
    db.run(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  });
}

// Middleware to verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Email validation helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Register endpoint
app.post('/register', (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(500).json({ message: 'Error registering user' });
    }

    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use' });
          }
          return res.status(400).json({ message: 'Error registering user' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  db.get('SELECT id, password FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err || !isMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
      res.status(200).json({ token });
    });
  });
});

// Create note endpoint
app.post('/notes', verifyToken, (req, res) => {
  const { title, content } = req.body;
  const userId = req.userId;

  // Validate input
  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required' });
  }

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
    function(err) {
      if (err) {
        return res.status(500).json({ message: 'Error creating note' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// List notes for current user
app.get('/notes', verifyToken, (req, res) => {
  const userId = req.userId;

  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Error fetching notes' });
      }
      res.status(200).json(rows || []);
    }
  );
});

// Get specific note
app.get('/notes/:id', verifyToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.userId;

  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ message: 'Error fetching note' });
      }
      
      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }

      // Check ownership
      if (note.user_id !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      res.status(200).json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    }
  );
});

// Delete note
app.delete('/notes/:id', verifyToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.userId;

  // First check if note exists and belongs to user
  db.get(
    'SELECT user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ message: 'Error deleting note' });
      }

      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }

      if (note.user_id !== userId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
        if (err) {
          return res.status(500).json({ message: 'Error deleting note' });
        }
        res.status(200).json({ message: 'Note deleted' });
      });
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});