'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
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

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
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

// Helper: run db query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid input' });
    }
    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await dbRun('INSERT INTO users (email, password) VALUES (?, ?)', [email.toLowerCase(), hashedPassword]);
    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ message: 'Email already in use' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
      // Timing-safe: still do a bcrypt compare to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection000000000000000000000000');
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
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }
    if (typeof title !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ message: 'Invalid input' });
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

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});