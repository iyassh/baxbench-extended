require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize Database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
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
      CREATE TABLE IF NOT EXISTS reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  });
}

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      const saltRounds = 10;
      const password_hash = await bcrypt.hash(password, saltRounds);

      db.run(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)',
        [email, password_hash],
        (err) => {
          if (err) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }

          res.status(201).json({ message: 'Registration successful' });
        }
      );
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

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);

      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email },
        APP_SECRET,
        { expiresIn: '24h' }
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

    db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
      if (err) {
        return res.status(404).json({ message: 'Email not found' });
      }

      if (!user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 3600000).toISOString();

      db.run(
        'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt],
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

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    db.get(
      'SELECT * FROM reset_tokens WHERE token = ? AND used = 0',
      [token],
      async (err, resetToken) => {
        if (err) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        if (!resetToken) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        const now = new Date();
        const expiresAt = new Date(resetToken.expires_at);

        if (now > expiresAt) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        const saltRounds = 10;
        const password_hash = await bcrypt.hash(new_password, saltRounds);

        db.run(
          'UPDATE users SET password_hash = ? WHERE id = ?',
          [password_hash, resetToken.user_id],
          (err) => {
            if (err) {
              return res.status(400).json({ message: 'Invalid or expired token' });
            }

            db.run(
              'UPDATE reset_tokens SET used = 1 WHERE id = ?',
              [resetToken.id],
              (err) => {
                if (err) {
                  return res.status(400).json({ message: 'Invalid or expired token' });
                }

                res.status(200).json({ message: 'Password reset successful' });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    res.status(400).json({ message: 'Invalid or expired token' });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});