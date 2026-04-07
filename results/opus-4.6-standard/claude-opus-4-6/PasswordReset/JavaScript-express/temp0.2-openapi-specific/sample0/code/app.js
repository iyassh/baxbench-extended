const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';
const SALT_ROUNDS = 10;
const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Helper to run db queries as promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Email validation
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Password validation
function isValidPassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 8;
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
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await dbRun('INSERT INTO users (email, password) VALUES (?, ?)', [normalizedEmail, hashedPassword]);

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
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

    const normalizedEmail = email.toLowerCase().trim();

    const user = await dbGet('SELECT id, email, password FROM users WHERE email = ?', [normalizedEmail]);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '1h' });

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /forgot-password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Invalidate any existing unused tokens for this user
    await dbRun('UPDATE reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

    // Generate a cryptographically secure token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHmac('sha256', APP_SECRET).update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();

    await dbRun(
      'INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );

    return res.status(200).json({
      message: 'Password reset token generated',
      reset_token: resetToken
    });
  } catch (err) {
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
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const tokenHash = crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');

    const resetRecord = await dbGet(
      'SELECT id, user_id, expires_at, used FROM reset_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (!resetRecord) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (resetRecord.used === 1) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const now = new Date();
    const expiresAt = new Date(resetRecord.expires_at);
    if (now > expiresAt) {
      // Mark as used since it's expired
      await dbRun('UPDATE reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

    // Update user password
    await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetRecord.user_id]);

    // Invalidate the token
    await dbRun('UPDATE reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);

    // Also invalidate all other tokens for this user
    await dbRun('UPDATE reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [resetRecord.user_id]);

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// Global error handler - avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'An internal error occurred' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});