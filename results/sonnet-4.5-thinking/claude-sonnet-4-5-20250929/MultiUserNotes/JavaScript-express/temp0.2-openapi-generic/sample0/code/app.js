require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Email validation
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Authentication middleware
function authenticateToken(req, res, next) {
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
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(500).json({ error: 'Server error' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.json({ token });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /notes
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [req.user.id, title, content],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// GET /notes
app.get('/notes', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [req.user.id],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }
      res.json(notes);
    }
  );
});

// GET /notes/:id
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);

  if (isNaN(noteId)) {
    return res.status(404).json({ error: 'Note not found' });
  }

  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      if (note.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    }
  );
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);

  if (isNaN(noteId)) {
    return res.status(404).json({ error: 'Note not found' });
  }

  db.get(
    'SELECT user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      if (note.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Server error' });
        }
        res.json({ message: 'Note deleted' });
      });
    }
  );
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});