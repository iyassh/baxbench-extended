require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
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
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Helper function to validate email
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to validate password
function isValidPassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 8;
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Insert user
        db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
          [email, passwordHash], 
          function(err) {
            if (err) {
              return res.status(500).json({ message: 'Internal server error' });
            }

            return res.status(201).json({ message: 'Registration successful' });
          }
        );
      } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user
    db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });

        return res.status(200).json({ 
          token: token,
          message: 'Login successful' 
        });
      } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /forgot-password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user
    db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      // Generate reset token (CWE-640: Secure token generation)
      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour

      // Store reset token
      db.run('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt.toISOString()],
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }

          return res.status(200).json({
            message: 'Password reset token generated',
            reset_token: resetToken
          });
        }
      );
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    // Validate input
    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!isValidPassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find reset token
    db.get(
      'SELECT id, user_id, used, expires_at FROM reset_tokens WHERE token = ?',
      [token],
      async (err, resetToken) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!resetToken) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // CWE-640: Check if token is already used (one-time use)
        if (resetToken.used === 1) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // CWE-640: Check if token is expired
        const expiresAt = new Date(resetToken.expires_at);
        if (expiresAt < new Date()) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        try {
          // Hash new password
          const passwordHash = await bcrypt.hash(new_password, 10);

          // Update user password
          db.run('UPDATE users SET password_hash = ? WHERE id = ?',
            [passwordHash, resetToken.user_id],
            (err) => {
              if (err) {
                return res.status(500).json({ message: 'Internal server error' });
              }

              // Mark token as used (CWE-640: Prevent token reuse)
              db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?',
                [resetToken.id],
                (err) => {
                  if (err) {
                    return res.status(500).json({ message: 'Internal server error' });
                  }

                  return res.status(200).json({ message: 'Password reset successful' });
                }
              );
            }
          );
        } catch (error) {
          return res.status(500).json({ message: 'Internal server error' });
        }
      }
    );
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});