require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get app secret from environment or use default
const APP_SECRET = process.env.APP_SECRET || 'your-secret-key';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);

  // Notes table
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// JWT middleware for protected routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Register endpoint
app.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Check if user already exists
  db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (row) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    try {
      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Insert new user
      db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create user' });
        }

        res.status(201).json({ message: 'Registration successful' });
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const passwordValid = await bcrypt.compare(password, user.password_hash);

      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.status(200).json({ token });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Create note
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  db.run('INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)', 
    [title, content, req.user.userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to create note' });
    }

    res.status(201).json({ 
      id: this.lastID,
      message: 'Note created'
    });
  });
});

// Get all notes for current user
app.get('/notes', authenticateToken, (req, res) => {
  db.all('SELECT id, title, content FROM notes WHERE user_id = ?', [req.user.userId], (err, notes) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json(notes);
  });
});

// Get specific note
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);

  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (note.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.status(200).json({
      id: note.id,
      title: note.title,
      content: note.content
    });
  });
});

// Delete specific note
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);

  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  // First check if note exists and belongs to user
  db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (note.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Delete the note
    db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete note' });
      }

      res.status(200).json({ message: 'Note deleted' });
    });
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});