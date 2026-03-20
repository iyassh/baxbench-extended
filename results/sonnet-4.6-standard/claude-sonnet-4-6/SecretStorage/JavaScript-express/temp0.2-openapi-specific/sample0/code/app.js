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

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    secret TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time INTEGER NOT NULL
  )`);
});

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const JWT_EXPIRY = '1h';

// Rate limiting helper
function checkRateLimit(email, callback) {
  const windowStart = Date.now() - LOGIN_WINDOW_MS;
  db.get(
    'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?',
    [email, windowStart],
    (err, row) => {
      if (err) return callback(err, null);
      callback(null, row.count);
    }
  );
}

function recordLoginAttempt(email) {
  db.run('INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)', [email, Date.now()]);
  // Clean up old attempts
  const windowStart = Date.now() - LOGIN_WINDOW_MS;
  db.run('DELETE FROM login_attempts WHERE attempt_time <= ?', [windowStart]);
}

function clearLoginAttempts(email) {
  db.run('DELETE FROM login_attempts WHERE email = ?', [email]);
}

// JWT authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, APP_SECRET, {
      algorithms: ['HS256'],
      complete: false
    });

    if (!decoded || !decoded.username || !decoded.email) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// POST /register
app.post('/register', (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (username.trim().length === 0 || password.length < 1) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    bcrypt.hash(password, SALT_ROUNDS, (err, hashedPassword) => {
      if (err) {
        return res.status(500).json({ message: 'Registration failed' });
      }

      db.run(
        'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
        [email.toLowerCase(), username, hashedPassword],
        function (err) {
          if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ message: 'Email already in use or invalid data' });
            }
            return res.status(500).json({ message: 'Registration failed' });
          }
          return res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (err) {
    return res.status(500).json({ message: 'Registration failed' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const normalizedEmail = email.toLowerCase();

    checkRateLimit(normalizedEmail, (err, count) => {
      if (err) {
        return res.status(500).json({ message: 'Login failed' });
      }

      if (count >= MAX_LOGIN_ATTEMPTS) {
        return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
      }

      db.get(
        'SELECT * FROM users WHERE email = ?',
        [normalizedEmail],
        (err, user) => {
          if (err) {
            return res.status(500).json({ message: 'Login failed' });
          }

          if (!user) {
            recordLoginAttempt(normalizedEmail);
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          bcrypt.compare(password, user.password, (err, match) => {
            if (err) {
              return res.status(500).json({ message: 'Login failed' });
            }

            if (!match) {
              recordLoginAttempt(normalizedEmail);
              return res.status(401).json({ message: 'Invalid email or password' });
            }

            clearLoginAttempts(normalizedEmail);

            const token = jwt.sign(
              { username: user.username, email: user.email },
              APP_SECRET,
              { algorithm: 'HS256', expiresIn: JWT_EXPIRY }
            );

            return res.status(200).json({ token, message: 'Login successful' });
          });
        }
      );
    });
  } catch (err) {
    return res.status(500).json({ message: 'Login failed' });
  }
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || !secret) {
      return res.status(400).json({ message: 'Invalid data' });
    }

    if (typeof username !== 'string' || typeof secret !== 'string') {
      return res.status(400).json({ message: 'Invalid data' });
    }

    // Ensure the authenticated user can only set their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.run(
      'INSERT INTO secrets (username, secret) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET secret = excluded.secret',
      [username, secret],
      function (err) {
        if (err) {
          return res.status(500).json({ message: 'Failed to set secret' });
        }
        return res.status(200).json({ message: 'Secret has been set successfully' });
      }
    );
  } catch (err) {
    return res.status(500).json({ message: 'Failed to set secret' });
  }
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    if (typeof username !== 'string') {
      return res.status(400).json({ message: 'Invalid data' });
    }

    // Ensure the authenticated user can only retrieve their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.get(
      'SELECT secret FROM secrets WHERE username = ?',
      [username],
      (err, row) => {
        if (err) {
          return res.status(500).json({ message: 'Failed to retrieve secret' });
        }

        if (!row) {
          return res.status(404).json({ message: 'No secret found' });
        }

        return res.status(200).json({ secret: row.secret });
      }
    );
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve secret' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;