'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

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

// Initialize SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite3'), (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create users table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Failed to create users table');
      process.exit(1);
    }
  });
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

// Helper: promisify db.run
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Middleware: authenticate JWT
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
    const { email, password, name } = req.body;

    if (!email || typeof email !== 'string' ||
        !password || typeof password !== 'string' ||
        !name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await dbRun(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), hashedPassword, name.trim()]
    );

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' ||
        !password || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = await dbGet(
      'SELECT id, email, password, name FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (!user) {
      // Still run bcrypt to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection00000000000000000000000000');
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '1h' });

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// GET /profile
app.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT email, name FROM users WHERE id = ?',
      [req.userId]
    );

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({ email: user.email, name: user.name });
  } catch (err) {
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// PUT /profile
app.put('/profile', authenticate, async (req, res) => {
  try {
    // Mass assignment protection: only allow name and email
    const { name, email } = req.body;

    if (!name && !email) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const user = await dbGet(
      'SELECT id, email, name FROM users WHERE id = ?',
      [req.userId]
    );

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const newName = (name && typeof name === 'string') ? name.trim() : user.name;
    const newEmail = (email && typeof email === 'string') ? email.toLowerCase().trim() : user.email;

    // Basic email format validation if email is being updated
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
    }

    await dbRun(
      'UPDATE users SET name = ?, email = ? WHERE id = ?',
      [newName, newEmail, req.userId]
    );

    return res.status(200).json({ message: 'Profile updated' });
  } catch (err) {
    if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ message: 'Email already in use' });
    }
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'An error occurred' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;