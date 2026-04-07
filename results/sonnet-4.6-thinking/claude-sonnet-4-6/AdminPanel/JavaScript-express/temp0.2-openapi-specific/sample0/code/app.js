'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-change-me';
const SALT_ROUNDS = 12;
const PORT = 5000;
const HOST = '0.0.0.0';
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
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
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
    db.run(sql, params, function(err) {
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
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json());

// Authentication middleware
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Admin authorization middleware
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden - admin access required' });
  }
  next();
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if email already exists
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Determine role: first user is admin
    const countRow = await dbGet('SELECT COUNT(*) as count FROM users', []);
    const role = countRow.count === 0 ? 'admin' : 'user';

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await dbRun('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [email, hashedPassword, role]);

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

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      // Still compare to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection000000000000000000000000');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      APP_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({ token });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /profile
app.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await dbGet('SELECT email, role FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.status(200).json({ email: user.email, role: user.role });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /admin/users
app.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await dbAll('SELECT id, email, role FROM users', []);
    return res.status(200).json(users);
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    return res.status(200).json({ message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;