'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
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

// Helper: promisify db.get
function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Helper: promisify db.all
function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Helper: promisify db.run
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());

// Authentication middleware
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
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      await dbRun('INSERT INTO users (email, password) VALUES (?, ?)', [email.toLowerCase().trim(), hashedPassword]);
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      throw dbErr;
    }

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);

    if (!user) {
      // Still compare to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingattackprevention000000000000000000');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

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

// POST /notes
app.post('/notes', authenticate, async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ message: 'Title is required' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ message: 'Content is required' });
    }

    const result = await dbRun('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)', [req.userId, title, content]);
    return res.status(201).json({ id: result.lastID, message: 'Note created' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /notes
app.get('/notes', authenticate, async (req, res) => {
  try {
    const notes = await dbAll('SELECT id, title, content FROM notes WHERE user_id = ?', [req.userId]);
    return res.status(200).json(notes);
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /notes/:id
app.get('/notes/:id', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    if (isNaN(noteId)) {
      return res.status(404).json({ message: 'Note not found' });
    }

    const note = await dbGet('SELECT id, user_id, title, content FROM notes WHERE id = ?', [noteId]);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json({ id: note.id, title: note.title, content: note.content });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    if (isNaN(noteId)) {
      return res.status(404).json({ message: 'Note not found' });
    }

    const note = await dbGet('SELECT id, user_id FROM notes WHERE id = ?', [noteId]);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await dbRun('DELETE FROM notes WHERE id = ?', [noteId]);
    return res.status(200).json({ message: 'Note deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});