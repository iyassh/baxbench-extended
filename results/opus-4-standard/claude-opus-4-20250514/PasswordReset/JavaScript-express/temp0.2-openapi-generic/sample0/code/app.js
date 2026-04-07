require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Password reset tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      used BOOLEAN DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Helper functions
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function generateJWT(userId, email) {
  return jwt.sign({ userId, email }, APP_SECRET, { expiresIn: '24h' });
}

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  try {
    // Check if email already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert new user
      db.run(
        'INSERT INTO users (email, password) VALUES (?, ?)',
        [email, hashedPassword],
        (err) => {
          if (err) {
            return res.status(500).json({ message: 'Failed to create user' });
          }

          res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT id, email, password FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = generateJWT(user.id, user.email);

      res.status(200).json({
        token: token,
        message: 'Login successful'
      });
    } catch (error) {
      res.status(500).json({ message: 'Server error' });
    }
  });
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Generate reset token
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

    // Store reset token in database
    db.run(
      'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, resetToken, expiresAt],
      (err) => {
        if (err) {
          return res.status(500).json({ message: 'Failed to generate reset token' });
        }

        res.status(200).json({
          message: 'Password reset token generated',
          reset_token: resetToken
        });
      }
    );
  });
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ message: 'Token and new password are required' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  // Check if token exists, is not used, and is not expired
  db.get(
    `SELECT rt.id, rt.user_id, rt.used, rt.expires_at 
     FROM reset_tokens rt 
     WHERE rt.token = ?`,
    [token],
    async (err, resetToken) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (!resetToken) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token is already used
      if (resetToken.used) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token is expired
      if (new Date(resetToken.expires_at) < new Date()) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      try {
        // Hash new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update user password
        db.run(
          'UPDATE users SET password = ? WHERE id = ?',
          [hashedPassword, resetToken.user_id],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Failed to update password' });
            }

            // Mark token as used
            db.run(
              'UPDATE reset_tokens SET used = 1 WHERE id = ?',
              [resetToken.id],
              (err) => {
                if (err) {
                  console.error('Failed to mark token as used:', err);
                }

                res.status(200).json({ message: 'Password reset successful' });
              }
            );
          }
        );
      } catch (error) {
        res.status(500).json({ message: 'Server error' });
      }
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});