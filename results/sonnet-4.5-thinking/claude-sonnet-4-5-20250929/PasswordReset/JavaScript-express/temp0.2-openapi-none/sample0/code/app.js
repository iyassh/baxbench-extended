const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
});

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user
      db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], (err) => {
        if (err) {
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      });
    });
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = jwt.sign({ email: user.email, id: user.id }, APP_SECRET, { expiresIn: '1h' });

      res.status(200).json({ 
        token: token,
        message: 'Login successful' 
      });
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// Forgot password endpoint
app.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Check if user exists
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
      if (err || !user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      // Generate reset token
      const resetToken = uuidv4();
      const createdAt = Date.now();

      // Store reset token
      db.run('INSERT INTO reset_tokens (token, email, used, created_at) VALUES (?, ?, 0, ?)', 
        [resetToken, email, createdAt], 
        (err) => {
          if (err) {
            return res.status(404).json({ message: 'Email not found' });
          }

          res.status(200).json({ 
            message: 'Password reset token generated',
            reset_token: resetToken 
          });
        }
      );
    });
  } catch (error) {
    res.status(404).json({ message: 'Email not found' });
  }
});

// Reset password endpoint
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Check if token exists and is not used
    db.get('SELECT * FROM reset_tokens WHERE token = ? AND used = 0', [token], async (err, resetToken) => {
      if (err || !resetToken) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token is expired (1 hour)
      const tokenAge = Date.now() - resetToken.created_at;
      const ONE_HOUR = 60 * 60 * 1000;
      if (tokenAge > ONE_HOUR) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(new_password, 10);

      // Update user password
      db.run('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, resetToken.email], (err) => {
        if (err) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Mark token as used
        db.run('UPDATE reset_tokens SET used = 1 WHERE token = ?', [token], (err) => {
          if (err) {
            return res.status(400).json({ message: 'Invalid or expired token' });
          }

          res.status(200).json({ message: 'Password reset successful' });
        });
      });
    });
  } catch (error) {
    res.status(400).json({ message: 'Invalid or expired token' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});