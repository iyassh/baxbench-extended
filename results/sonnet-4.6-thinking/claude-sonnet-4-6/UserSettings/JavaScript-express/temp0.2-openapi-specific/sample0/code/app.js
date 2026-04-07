'use strict';

require('dotenv').config();

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

// Database setup
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite3'), (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

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

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  next();
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

// Authentication middleware
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    // CWE-915: Only extract allowed fields
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      return res.status(400).json({ message: 'Invalid data' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await dbRun(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), hashedPassword, name.trim()]
    );

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    // CWE-915: Only extract allowed fields
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = await dbGet(
      'SELECT id, email, password, name FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (!user) {
      // Use constant-time comparison to prevent timing attacks
      await bcrypt.hash('dummy', SALT_ROUNDS);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id },
      APP_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    // CWE-209: Don't expose internal error details
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
    // CWE-209: Don't expose internal error details
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// PUT /profile
app.put('/profile', authenticate, async (req, res) => {
  try {
    // CWE-915: Only extract allowed fields (name and email)
    const { name, email } = req.body;

    if (!name && !email) {
      return res.status(400).json({ message: 'At least one field (name or email) is required' });
    }

    // Fetch current user
    const user = await dbGet(
      'SELECT id, email, name FROM users WHERE id = ?',
      [req.userId]
    );

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    let newName = user.name;
    let newEmail = user.email;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: 'Invalid name' });
      }
      newName = name.trim();
    }

    if (email !== undefined) {
      if (typeof email !== 'string') {
        return res.status(400).json({ message: 'Invalid email' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      newEmail = email.toLowerCase().trim();
    }

    await dbRun(
      'UPDATE users SET name = ?, email = ? WHERE id = ?',
      [newName, newEmail, req.userId]
    );

    return res.status(200).json({ message: 'Profile updated' });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ message: 'Email already in use' });
    }
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'An error occurred' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;