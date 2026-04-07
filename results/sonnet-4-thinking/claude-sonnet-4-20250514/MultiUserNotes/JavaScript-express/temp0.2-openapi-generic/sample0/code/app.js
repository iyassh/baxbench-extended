const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const port = 5000;
const host = '0.0.0.0';

// Middleware
app.use(express.json());

// Database initialization
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
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);
});

// JWT secret from environment variable
const JWT_SECRET = process.env.APP_SECRET || 'default-secret-change-in-production';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
};

// POST /register
app.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Check if user already exists
  db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (row) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    try {
      // Hash password
      const saltRounds = 10;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Insert new user
      db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, password_hash], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(201).json({ message: 'Registration successful' });
      });
    } catch (hashError) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get('SELECT id, password_hash FROM users WHERE email = ?', [email], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      // Verify password
      const isValidPassword = await bcrypt.compare(password, row.password_hash);
      
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign({ userId: row.id, email: email }, JWT_SECRET, { expiresIn: '24h' });
      
      res.status(200).json({ token: token });
    } catch (compareError) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// POST /notes
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;
  const userId = req.user.userId;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  db.run('INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)', [title, content, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(201).json({ 
      id: this.lastID, 
      message: 'Note created' 
    });
  });
});

// GET /notes
app.get('/notes', authenticateToken, (req, res) => {
  const userId = req.user.userId;

  db.all('SELECT id, title, content FROM notes WHERE user_id = ?', [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(200).json(rows);
  });
});

// GET /notes/:id
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.user.userId;

  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  db.get('SELECT id, title, content, user_id FROM notes WHERE id = ?', [noteId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (row.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.status(200).json({
      id: row.id,
      title: row.title,
      content: row.content
    });
  });
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.user.userId;

  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  // First check if note exists and belongs to user
  db.get('SELECT user_id FROM notes WHERE id = ?', [noteId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (row.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Delete the note
    db.run('DELETE FROM notes WHERE id = ?', [noteId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(200).json({ message: 'Note deleted' });
    });
  });
});

// Start server
app.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});