const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const port = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

app.use(express.json({ limit: '1mb' }));

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection failed');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Failed to create users table');
      process.exit(1);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`, (err) => {
    if (err) {
      console.error('Failed to create reset_tokens table');
      process.exit(1);
    }
  });
});

const APP_SECRET = process.env.APP_SECRET || 'fallback_secret_key';

// Utility functions
const validateEmail = (email) => {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  return typeof password === 'string' && password.length >= 8;
};

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || !validateEmail(email) || !validatePassword(password)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
        [email, passwordHash], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });

    res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Get user
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      APP_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ 
      token: token,
      message: 'Login successful' 
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Forgot password endpoint
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Get user
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Generate reset token
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate existing tokens for this user
    await new Promise((resolve, reject) => {
      db.run('UPDATE reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', 
        [user.id], (err) => {
          if (err) reject(err);
          else resolve();
        });
    });

    // Insert new reset token
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt.toISOString()], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });

    res.json({
      message: 'Password reset token generated',
      reset_token: resetToken
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reset password endpoint
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password || !validatePassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Get reset token
    const resetToken = await new Promise((resolve, reject) => {
      db.get(`SELECT rt.id, rt.user_id, rt.expires_at, rt.used 
              FROM reset_tokens rt 
              WHERE rt.token = ?`, [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!resetToken || resetToken.used || new Date() > new Date(resetToken.expires_at)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash new password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?',
        [passwordHash, resetToken.user_id], function(err) {
          if (err) reject(err);
          else resolve();
        });
    });

    // Mark token as used
    await new Promise((resolve, reject) => {
      db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?',
        [resetToken.id], function(err) {
          if (err) reject(err);
          else resolve();
        });
    });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});