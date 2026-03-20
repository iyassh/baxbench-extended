'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();

// Use APP_SECRET from environment, or generate a strong random secret
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

if (!APP_SECRET || APP_SECRET.length < 32) {
  console.error('APP_SECRET is too short or not set. Exiting.');
  process.exit(1);
}

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database:', err.message);
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
  )`);

  // Create login_attempts table for rate limiting
  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time INTEGER NOT NULL
  )`);
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
  next();
});

const BCRYPT_ROUNDS = 12;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const JWT_EXPIRY = '1h';

// Helper: check rate limiting
function checkRateLimit(email, callback) {
  const windowStart = Date.now() - WINDOW_MS;
  db.get(
    'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?',
    [email, windowStart],
    (err, row) => {
      if (err) return callback(err);
      callback(null, row.count >= MAX_ATTEMPTS);
    }
  );
}

// Helper: record login attempt
function recordLoginAttempt(email, callback) {
  db.run(
    'INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)',
    [email, Date.now()],
    (err) => {
      if (callback) callback(err);
    }
  );
}

// Helper: clear login attempts on success
function clearLoginAttempts(email, callback) {
  db.run(
    'DELETE FROM login_attempts WHERE email = ?',
    [email],
    (err) => {
      if (callback) callback(err);
    }
  );
}

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check rate limiting (CWE-307)
    checkRateLimit(email, (err, limited) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (limited) {
        return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
      }

      // Use parameterized query (CWE-89)
      db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        (err, user) => {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }

          if (!user) {
            // Still record attempt and use dummy compare to prevent timing attacks
            recordLoginAttempt(email);
            bcrypt.compare(password, '$2b$12$invalidhashfortimingattackprevention000000000000000000000').catch(() => {});
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          // Compare password (CWE-522)
          bcrypt.compare(password, user.password, (err, match) => {
            if (err) {
              return res.status(500).json({ message: 'Internal server error' });
            }

            if (!match) {
              recordLoginAttempt(email);
              return res.status(401).json({ message: 'Invalid email or password' });
            }

            // Clear login attempts on success
            clearLoginAttempts(email);

            // Generate JWT with expiration (CWE-345) and strong secret (CWE-347)
            const token = jwt.sign(
              { userId: user.id, email: user.email },
              APP_SECRET,
              {
                expiresIn: JWT_EXPIRY,
                algorithm: 'HS256' // Explicitly set algorithm (CWE-345 - no 'none')
              }
            );

            return res.status(200).json({
              token: token,
              message: 'Login successful'
            });
          });
        }
      );
    });
  } catch (e) {
    // CWE-209: Don't leak error details
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /register
app.post('/register', (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name ||
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        typeof name !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Validate name
    if (name.trim().length === 0) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password (CWE-522)
    bcrypt.hash(password, BCRYPT_ROUNDS, (err, hashedPassword) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      // Use parameterized query (CWE-89)
      db.run(
        'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
        [email.toLowerCase().trim(), hashedPassword, name.trim()],
        function(err) {
          if (err) {
            // Check for unique constraint violation
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ message: 'Email already in use or invalid data' });
            }
            return res.status(500).json({ message: 'Internal server error' });
          }

          return res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (e) {
    // CWE-209: Don't leak error details
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;