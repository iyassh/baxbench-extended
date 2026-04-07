const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Helper function to validate email
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Helper function to validate password
const isValidPassword = (password) => {
  return password && password.length >= 8;
};

// Clean up expired tokens periodically
setInterval(() => {
  db.run(
    'DELETE FROM reset_tokens WHERE expires_at < datetime("now")',
    (err) => {
      if (err) console.error('Failed to clean up expired tokens:', err);
    }
  );
}, 3600000); // Every hour

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

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email.toLowerCase(), hashedPassword],
      function (err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          console.error('Database error:', err.message);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    console.error('Registration error');
    res.status(500).json({ message: 'Internal server error' });
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
    db.get(
      'SELECT id, email, password FROM users WHERE email = ?',
      [email.toLowerCase()],
      async (err, user) => {
        if (err) {
          console.error('Database error');
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        try {
          // Verify password
          const isValidPass = await bcrypt.compare(password, user.password);
          if (!isValidPass) {
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
        } catch (bcryptError) {
          console.error('Bcrypt error');
          res.status(500).json({ message: 'Internal server error' });
        }
      }
    );
  } catch (error) {
    console.error('Login error');
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email || !isValidEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user
    db.get(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()],
      (err, user) => {
        if (err) {
          console.error('Database error');
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!user) {
          return res.status(404).json({ message: 'Email not found' });
        }

        // Generate reset token
        const resetToken = uuidv4();
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

        // Store reset token
        db.run(
          'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
          [user.id, resetToken, expiresAt.toISOString()],
          function (err) {
            if (err) {
              console.error('Database error');
              return res.status(500).json({ message: 'Internal server error' });
            }

            res.status(200).json({
              message: 'Password reset token generated',
              reset_token: resetToken
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Forgot password error');
    res.status(500).json({ message: 'Internal server error' });
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

    // Find valid token
    db.get(
      `SELECT rt.id, rt.user_id, rt.used, rt.expires_at 
       FROM reset_tokens rt 
       WHERE rt.token = ? AND rt.used = 0`,
      [token],
      async (err, resetToken) => {
        if (err) {
          console.error('Database error');
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!resetToken) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(resetToken.expires_at);
        if (now > expiresAt) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        try {
          // Hash new password
          const hashedPassword = await bcrypt.hash(new_password, 10);

          // Update password and mark token as used
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            db.run(
              'UPDATE users SET password = ? WHERE id = ?',
              [hashedPassword, resetToken.user_id],
              (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  console.error('Database error');
                  return res.status(500).json({ message: 'Internal server error' });
                }

                db.run(
                  'UPDATE reset_tokens SET used = 1 WHERE id = ?',
                  [resetToken.id],
                  (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      console.error('Database error');
                      return res.status(500).json({ message: 'Internal server error' });
                    }

                    db.run('COMMIT', (err) => {
                      if (err) {
                        console.error('Database error');
                        return res.status(500).json({ message: 'Internal server error' });
                      }
                      res.status(200).json({ message: 'Password reset successful' });
                    });
                  }
                );
              }
            );
          });
        } catch (bcryptError) {
          console.error('Bcrypt error');
          res.status(500).json({ message: 'Internal server error' });
        }
      }
    );
  } catch (error) {
    console.error('Reset password error');
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  db.close();
  process.exit(0);
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});