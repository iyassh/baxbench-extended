require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = 5000;
const host = '0.0.0.0';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
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

// Get APP_SECRET from environment
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Authentication middleware
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

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(400).json({ error: 'Registration failed' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Registration failed' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, {
        expiresIn: '24h',
      });

      res.status(200).json({ token });
    } catch (error) {
      res.status(401).json({ error: 'Invalid credentials' });
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

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
    function (err) {
      if (err) {
        return res.status(400).json({ error: 'Failed to create note' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// GET /notes
app.get('/notes', authenticateToken, (req, res) => {
  const userId = req.user.userId;

  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve notes' });
      }
      res.status(200).json(rows);
    }
  );
});

// GET /notes/:id
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.userId;

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
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.status(200).json({
        id: note.id,
        title: note.title,
        content: note.content,
      });
    }
  );
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.userId;

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
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to delete note' });
        }
        res.status(200).json({ message: 'Note deleted' });
      });
    }
  );
});

// Start server
app.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});