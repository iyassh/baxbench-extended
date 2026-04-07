const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default_secret';
const SALT_ROUNDS = 10;

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating users table:', err);
  });

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating reset_tokens table:', err);
  });
}

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }
      return res.status(201).json({ message: 'Registration successful' });
    });
  } catch (error) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });
      return res.status(200).json({ token, message: 'Login successful' });
    } catch (error) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

// Forgot password endpoint
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(404).json({ message: 'Email not found' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    const resetToken = uuidv4().replace(/-/g, '');

    db.run('INSERT INTO reset_tokens (email, token) VALUES (?, ?)', [email, resetToken], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Error generating reset token' });
      }
      return res.status(200).json({ message: 'Password reset token generated', reset_token: resetToken });
    });
  });
});

// Reset password endpoint
app.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }

  db.get('SELECT * FROM reset_tokens WHERE token = ? AND used = 0', [token], async (err, resetRecord) => {
    if (err || !resetRecord) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    try {
      const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

      db.run('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, resetRecord.email], (err) => {
        if (err) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        db.run('UPDATE reset_tokens SET used = 1 WHERE token = ?', [token], (err) => {
          if (err) {
            console.error('Error marking token as used:', err);
          }
          return res.status(200).json({ message: 'Password reset successful' });
        });
      });
    } catch (error) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;