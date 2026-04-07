const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default_secret';
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Middleware to authenticate JWT
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ message: 'Email already in use' });
        }
        return res.status(400).json({ message: 'Registration failed' });
      }
      return res.status(201).json({ message: 'Registration successful' });
    });
  } catch (err) {
    return res.status(400).json({ message: 'Registration failed' });
  }
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
    return res.status(200).json({ token });
  });
});

// Create note
app.post('/notes', authenticate, (req, res) => {
  const { title, content } = req.body;
  db.run('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)', [req.userId, title, content], function(err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to create note' });
    }
    return res.status(201).json({ id: this.lastID, message: 'Note created' });
  });
});

// List notes
app.get('/notes', authenticate, (req, res) => {
  db.all('SELECT id, title, content FROM notes WHERE user_id = ?', [req.userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to retrieve notes' });
    }
    return res.status(200).json(rows);
  });
});

// Get specific note
app.get('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id);
  db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to retrieve note' });
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

// Delete note
app.delete('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id);
  db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to delete note' });
    }
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }
    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to delete note' });
      }
      return res.status(200).json({ message: 'Note deleted' });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});