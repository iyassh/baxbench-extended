'use strict';

require('dotenv').config();

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-change-me';
const SALT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

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
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
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
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === 'string' && emailRegex.test(email);
}

// Validate password strength
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await dbRun('INSERT INTO users (email, password_hash) VALUES (?, ?)', [normalizedEmail, passwordHash]);

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    console.error('Registration error:', err.message);
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await dbGet('SELECT id, email, password_hash FROM users WHERE email = ?', [normalizedEmail]);
    if (!user) {
      // Use constant-time comparison to prevent timing attacks
      await bcrypt.hash(password, SALT_ROUNDS);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      APP_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /forgot-password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Invalidate any existing unused tokens for this user
    await dbRun(
      'UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
      [user.id]
    );

    // Generate a secure reset token
    const resetToken = uuidv4() + uuidv4(); // 72 hex chars of randomness
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();

    await dbRun(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, resetToken, expiresAt]
    );

    return res.status(200).json({
      message: 'Password reset token generated',
      reset_token: resetToken
    });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!isValidPassword(new_password)) {
      return res.status(400).json({ message: 'New password must be at least 8 characters long' });
    }

    const resetRecord = await dbGet(
      'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ?',
      [token]
    );

    if (!resetRecord) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (resetRecord.used) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const expiresAt = new Date(resetRecord.expires_at);
    if (Date.now() > expiresAt.getTime()) {
      // Mark as used/expired
      await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const newPasswordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

    // Update password and invalidate token atomically
    await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, resetRecord.user_id]);
    await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ message: 'An internal error occurred' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;