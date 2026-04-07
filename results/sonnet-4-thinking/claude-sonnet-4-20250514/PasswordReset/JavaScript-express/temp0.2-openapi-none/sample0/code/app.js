const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Reset tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

const APP_SECRET = process.env.APP_SECRET || 'default_secret_key';

// Helper functions
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePassword(password) {
  return password && password.length >= 6;
}

// Routes

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if email already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      // Hash password
      const saltRounds = 10;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Insert user
      db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, password_hash], function(err) {
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

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user
    db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!row) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Verify password
      const isMatch = await bcrypt.compare(password, row.password_hash);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: row.id, email: row.email },
        APP_SECRET,
        { expiresIn: '1h' }
      );

      res.status(200).json({
        token: token,
        message: 'Login successful'
      });
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user
    db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
      if (err) {
        return res.status(404).json({ message: 'Email not found' });
      }

      if (!row) {
        return res.status(404).json({ message: 'Email not found' });
      }

      // Generate reset token
      const reset_token = uuidv4();

      // Store reset token
      db.run('INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)', [row.id, reset_token], function(err) {
        if (err) {
          return res.status(404).json({ message: 'Email not found' });
        }

        res.status(200).json({
          message: 'Password reset token generated',
          reset_token: reset_token
        });
      });
    });
  } catch (error) {
    res.status(404).json({ message: 'Email not found' });
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!validatePassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find valid reset token
    db.get(`
      SELECT rt.id, rt.user_id, rt.created_at 
      FROM reset_tokens rt 
      WHERE rt.token = ? AND rt.used = 0
    `, [token], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      if (!row) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token is expired (24 hours)
      const tokenAge = Date.now() - new Date(row.created_at).getTime();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      if (tokenAge > twentyFourHours) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Hash new password
      const saltRounds = 10;
      const password_hash = await bcrypt.hash(new_password, saltRounds);

      // Update user password
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, row.user_id], (err) => {
        if (err) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Mark token as used
        db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?', [row.id], (err) => {
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
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});