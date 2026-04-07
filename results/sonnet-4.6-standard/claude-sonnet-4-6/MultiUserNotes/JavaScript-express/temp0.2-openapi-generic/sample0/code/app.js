const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Middleware to authenticate JWT
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, APP_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ message: 'Email already in use' });
        }
        return res.status(500).json({ message: 'Internal server error' });
      }
      return res.status(201).json({ message: 'Registration successful' });
    });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    try {
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
      return res.status(200).json({ token });
    } catch (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
  });
});

// POST /notes
app.post('/notes', authenticate, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required' });
  }

  db.run('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)', [req.userId, title, content], function(err) {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    return res.status(201).json({ id: this.lastID, message: 'Note created' });
  });
});

// GET /notes
app.get('/notes', authenticate, (req, res) => {
  db.all('SELECT id, title, content FROM notes WHERE user_id = ?', [req.userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    return res.status(200).json(rows);
  });
});

// GET /notes/:id
app.get('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id, 10);
  if (isNaN(noteId)) {
    return res.status(404).json({ message: 'Note not found' });
  }

  db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }
    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return res.status(200).json({ id: note.id, title: note.title, content: note.content });
  });
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id, 10);
  if (isNaN(noteId)) {
    return res.status(404).json({ message: 'Note not found' });
  }

  db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }
    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      return res.status(200).json({ message: 'Note deleted' });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});