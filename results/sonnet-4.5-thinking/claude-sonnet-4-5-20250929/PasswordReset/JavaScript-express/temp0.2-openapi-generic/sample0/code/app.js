require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';
const PORT = 5000;
const HOST = '0.0.0.0';

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
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
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        // Hash password
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // Insert user
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
      } catch (hashError) {
        res.status(400).json({ message: 'Email already in use or invalid data' });
      }
    });
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { userId: user.id, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({
          token: token,
          message: 'Login successful'
        });
      } catch (compareError) {
        res.status(401).json({ message: 'Invalid email or password' });
      }
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Check if user exists
    db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
      if (err || !user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      // Generate reset token
      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Store reset token
      db.run(
        'INSERT INTO reset_tokens (token, email, expires_at) VALUES (?, ?, ?)',
        [resetToken, email, expiresAt.toISOString()],
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

    // Verify token
    db.get(
      'SELECT * FROM reset_tokens WHERE token = ? AND used = 0',
      [token],
      async (err, resetToken) => {
        if (err || !resetToken) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Check if token is expired
        const expiresAt = new Date(resetToken.expires_at);
        if (expiresAt < new Date()) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        try {
          // Hash new password
          const saltRounds = 10;
          const password_hash = await bcrypt.hash(new_password, saltRounds);

          // Update user password
          db.run(
            'UPDATE users SET password_hash = ? WHERE email = ?',
            [password_hash, resetToken.email],
            (err) => {
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
            }
          );
        } catch (hashError) {
          res.status(400).json({ message: 'Invalid or expired token' });
        }
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