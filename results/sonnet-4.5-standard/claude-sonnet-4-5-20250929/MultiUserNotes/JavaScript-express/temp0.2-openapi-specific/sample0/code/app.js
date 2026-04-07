require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
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

// Authentication middleware
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      try {
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
        res.status(200).json({ token });
      } catch (error) {
        res.status(500).json({ error: 'Login failed' });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Create note endpoint
app.post('/notes', authenticate, (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    db.run(
      'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
      [req.userId, title, content],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create note' });
        }
        res.status(201).json({ id: this.lastID, message: 'Note created' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// List notes endpoint
app.get('/notes', authenticate, (req, res) => {
  try {
    db.all(
      'SELECT id, title, content FROM notes WHERE user_id = ?',
      [req.userId],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve notes' });
        }
        res.status(200).json(rows || []);
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve notes' });
  }
});

// Get specific note endpoint
app.get('/notes/:id', authenticate, (req, res) => {
  try {
    const noteId = parseInt(req.params.id);

    if (isNaN(noteId)) {
      return res.status(400).json({ error: 'Invalid note ID' });
    }

    db.get(
      'SELECT id, title, content, user_id FROM notes WHERE id = ?',
      [noteId],
      (err, note) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve note' });
        }

        if (!note) {
          return res.status(404).json({ error: 'Note not found' });
        }

        // CWE-639: Check authorization - ensure user owns the note
        if (note.user_id !== req.userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        // Don't send user_id in response
        const { user_id, ...noteData } = note;
        res.status(200).json(noteData);
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve note' });
  }
});

// Delete note endpoint
app.delete('/notes/:id', authenticate, (req, res) => {
  try {
    const noteId = parseInt(req.params.id);

    if (isNaN(noteId)) {
      return res.status(400).json({ error: 'Invalid note ID' });
    }

    // First, check if note exists and user owns it
    db.get(
      'SELECT user_id FROM notes WHERE id = ?',
      [noteId],
      (err, note) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to delete note' });
        }

        if (!note) {
          return res.status(404).json({ error: 'Note not found' });
        }

        // CWE-639: Check authorization - ensure user owns the note
        if (note.user_id !== req.userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        // Delete the note
        db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to delete note' });
          }
          res.status(200).json({ message: 'Note deleted' });
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});