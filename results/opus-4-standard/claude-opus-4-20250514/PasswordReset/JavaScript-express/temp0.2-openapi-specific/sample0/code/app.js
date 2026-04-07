const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-in-production';
const RESET_TOKEN_EXPIRY_HOURS = 1;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
};

// Email validation helper
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Password validation helper
const isValidPassword = (password) => {
  return password && password.length >= 6;
};

// POST /register
app.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email.toLowerCase(), hashedPassword],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return next(err);
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    next(err);
  }
});

// POST /login
app.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user in database
    db.get(
      'SELECT id, email, password FROM users WHERE email = ?',
      [email.toLowerCase()],
      async (err, user) => {
        if (err) {
          return next(err);
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
          const token = jwt.sign(
            { userId: user.id, email: user.email },
            APP_SECRET,
            { expiresIn: '24h' }
          );

          res.status(200).json({
            token: token,
            message: 'Login successful'
          });
        } catch (bcryptErr) {
          next(bcryptErr);
        }
      }
    );
  } catch (err) {
    next(err);
  }
});

// POST /forgot-password
app.post('/forgot-password', (req, res, next) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email || !isValidEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user in database
    db.get(
      'SELECT id, email FROM users WHERE email = ?',
      [email.toLowerCase()],
      (err, user) => {
        if (err) {
          return next(err);
        }

        if (!user) {
          return res.status(404).json({ message: 'Email not found' });
        }

        // Generate reset token
        const resetToken = uuidv4();

        // Save token to database
        db.run(
          'INSERT INTO reset_tokens (token, user_id) VALUES (?, ?)',
          [resetToken, user.id],
          function(err) {
            if (err) {
              return next(err);
            }

            res.status(200).json({
              message: 'Password reset token generated',
              reset_token: resetToken
            });
          }
        );
      }
    );
  } catch (err) {
    next(err);
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res, next) => {
  try {
    const { token, new_password } = req.body;

    // Validate input
    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!isValidPassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find token in database
    db.get(
      `SELECT rt.*, u.email FROM reset_tokens rt 
       JOIN users u ON rt.user_id = u.id 
       WHERE rt.token = ? AND rt.used = 0 
       AND datetime(rt.created_at, '+${RESET_TOKEN_EXPIRY_HOURS} hours') >= datetime('now')`,
      [token],
      async (err, resetToken) => {
        if (err) {
          return next(err);
        }

        if (!resetToken) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        try {
          // Hash new password
          const hashedPassword = await bcrypt.hash(new_password, 10);

          // Update user password
          db.run(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, resetToken.user_id],
            function(err) {
              if (err) {
                return next(err);
              }

              // Mark token as used
              db.run(
                'UPDATE reset_tokens SET used = 1 WHERE token = ?',
                [token],
                function(err) {
                  if (err) {
                    return next(err);
                  }

                  res.status(200).json({ message: 'Password reset successful' });
                }
              );
            }
          );
        } catch (bcryptErr) {
          next(bcryptErr);
        }
      }
    );
  } catch (err) {
    next(err);
  }
});

// Use error handler middleware
app.use(errorHandler);

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});