'use strict';

require('dotenv').config();

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-change-me';
const SALT_ROUNDS = 12;
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

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
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Helper: validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === 'string' && emailRegex.test(email);
}

// Helper: validate password
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], async (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'An error occurred' });
      }
      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const now = Date.now();

        db.run(
          'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)',
          [normalizedEmail, passwordHash, now],
          function (err) {
            if (err) {
              return res.status(500).json({ message: 'An error occurred' });
            }
            return res.status(201).json({ message: 'Registration successful' });
          }
        );
      } catch (hashErr) {
        return res.status(500).json({ message: 'An error occurred' });
      }
    });
  } catch (err) {
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isValidEmail(email) || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [normalizedEmail], async (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'An error occurred' });
      }

      if (!row) {
        // Still do a dummy compare to prevent timing attacks
        await bcrypt.compare(password, '$2b$12$invalidhashfortimingattackprevention000000000000000000');
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        const match = await bcrypt.compare(password, row.password_hash);
        if (!match) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { userId: row.id, email: row.email },
          APP_SECRET,
          { expiresIn: '1h' }
        );

        return res.status(200).json({ token, message: 'Login successful' });
      } catch (compareErr) {
        return res.status(500).json({ message: 'An error occurred' });
      }
    });
  } catch (err) {
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail], (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'An error occurred' });
      }

      if (!row) {
        return res.status(404).json({ message: 'Email not found' });
      }

      const resetToken = uuidv4() + uuidv4(); // 72 chars of randomness
      const expiresAt = Date.now() + TOKEN_EXPIRY_MS;

      db.run(
        'INSERT INTO reset_tokens (user_id, token, expires_at, used) VALUES (?, ?, ?, 0)',
        [row.id, resetToken, expiresAt],
        function (err) {
          if (err) {
            return res.status(500).json({ message: 'An error occurred' });
          }
          return res.status(200).json({
            message: 'Password reset token generated',
            reset_token: resetToken
          });
        }
      );
    });
  } catch (err) {
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!isValidPassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const now = Date.now();

    db.get(
      'SELECT id, user_id FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?',
      [token, now],
      async (err, tokenRow) => {
        if (err) {
          return res.status(500).json({ message: 'An error occurred' });
        }

        if (!tokenRow) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        try {
          const passwordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

          // Mark token as used first
          db.run(
            'UPDATE reset_tokens SET used = 1 WHERE id = ?',
            [tokenRow.id],
            function (err) {
              if (err) {
                return res.status(500).json({ message: 'An error occurred' });
              }

              // Update user password
              db.run(
                'UPDATE users SET password_hash = ? WHERE id = ?',
                [passwordHash, tokenRow.user_id],
                function (err) {
                  if (err) {
                    return res.status(500).json({ message: 'An error occurred' });
                  }
                  return res.status(200).json({ message: 'Password reset successful' });
                }
              );
            }
          );
        } catch (hashErr) {
          return res.status(500).json({ message: 'An error occurred' });
        }
      }
    );
  } catch (err) {
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// Generic error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'An error occurred' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});