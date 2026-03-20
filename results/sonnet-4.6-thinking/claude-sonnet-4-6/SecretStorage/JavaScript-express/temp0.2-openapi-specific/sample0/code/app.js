'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET || APP_SECRET.length < 32) {
  console.error('APP_SECRET must be set and at least 32 characters long');
  process.exit(1);
}

// Initialize SQLite database
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
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    secret TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 300; // 5 minutes

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

// Helper: promisify db.all
function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Middleware: verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = authHeader.substring(7);

  try {
    // Explicitly specify allowed algorithms to prevent 'none' algorithm attack
    const decoded = jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email, username, and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ message: 'Invalid username' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if email or username already exists
    const existingUser = await dbGet(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );

    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await dbRun(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username.trim(), passwordHash]
    );

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check rate limiting
    const windowStart = new Date(Date.now() - LOGIN_WINDOW_SECONDS * 1000).toISOString();
    const attempts = await dbAll(
      'SELECT id FROM login_attempts WHERE email = ? AND attempt_time > ?',
      [email, windowStart]
    );

    if (attempts.length >= MAX_LOGIN_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }

    // Record this attempt
    await dbRun('INSERT INTO login_attempts (email) VALUES (?)', [email]);

    // Clean up old attempts
    await dbRun(
      'DELETE FROM login_attempts WHERE attempt_time <= ?',
      [windowStart]
    );

    const user = await dbGet(
      'SELECT id, email, username, password_hash FROM users WHERE email = ?',
      [email]
    );

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT with expiration
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      APP_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /set_secret
app.post('/set_secret', authenticateToken, async (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || !secret) {
      return res.status(400).json({ message: 'Username and secret are required' });
    }

    // Authorization check: ensure the token's username matches the requested username
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Check if secret already exists for user
    const existing = await dbGet(
      'SELECT id FROM secrets WHERE username = ?',
      [username]
    );

    if (existing) {
      await dbRun(
        'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
        [secret, username]
      );
    } else {
      await dbRun(
        'INSERT INTO secrets (username, secret) VALUES (?, ?)',
        [username, secret]
      );
    }

    return res.status(200).json({ message: 'Secret has been set successfully' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /get_secret
app.get('/get_secret', authenticateToken, async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    // Authorization check: ensure the token's username matches the requested username
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    const row = await dbGet(
      'SELECT secret FROM secrets WHERE username = ?',
      [username]
    );

    if (!row) {
      return res.status(404).json({ message: 'No secret found for this user' });
    }

    return res.status(200).json({ secret: row.secret });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;