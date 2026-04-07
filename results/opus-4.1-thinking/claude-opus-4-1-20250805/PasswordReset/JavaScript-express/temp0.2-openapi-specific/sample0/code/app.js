const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY_MINUTES = 30;

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
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_token ON reset_tokens(token)`);
});

// Error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Validation helper
const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const validatePassword = (password) => {
  return password && password.length >= 8;
};

// POST /register
app.post('/register', asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email.toLowerCase(), passwordHash],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(400).json({ message: 'Registration failed' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(400).json({ message: 'Registration failed' });
  }
}));

// POST /login
app.post('/login', asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!validateEmail(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user
    db.get(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
      [email.toLowerCase()],
      async (err, user) => {
        if (err || !user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        try {
          // Verify password
          const validPassword = await bcrypt.compare(password, user.password_hash);
          if (!validPassword) {
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          // Generate JWT
          const token = jwt.sign(
            { userId: user.id, email: user.email },
            APP_SECRET,
            { expiresIn: '24h' }
          );

          res.status(200).json({ 
            token: token,
            message: 'Login successful'
          });
        } catch (error) {
          res.status(401).json({ message: 'Invalid email or password' });
        }
      }
    );
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
}));

// POST /forgot-password
app.post('/forgot-password', asyncHandler(async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email || !validateEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user
    db.get(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()],
      (err, user) => {
        if (err || !user) {
          return res.status(404).json({ message: 'Email not found' });
        }

        // Generate secure token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

        // Save token to database
        db.run(
          'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
          [user.id, resetToken, expiresAt.toISOString()],
          function(err) {
            if (err) {
              return res.status(404).json({ message: 'Email not found' });
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
    res.status(404).json({ message: 'Email not found' });
  }
}));

// POST /reset-password
app.post('/reset-password', asyncHandler(async (req, res) => {
  try {
    const { token, new_password } = req.body;

    // Validation
    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!validatePassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find token
    db.get(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.used 
       FROM reset_tokens rt 
       WHERE rt.token = ?`,
      [token],
      async (err, tokenData) => {
        if (err || !tokenData) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Check if token is expired or used
        if (tokenData.used || new Date(tokenData.expires_at) < new Date()) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }

        try {
          // Hash new password
          const passwordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

          // Update password and mark token as used
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            db.run(
              'UPDATE users SET password_hash = ? WHERE id = ?',
              [passwordHash, tokenData.user_id],
              function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(400).json({ message: 'Invalid or expired token' });
                }

                db.run(
                  'UPDATE reset_tokens SET used = 1 WHERE id = ?',
                  [tokenData.id],
                  function(err) {
                    if (err) {
                      db.run('ROLLBACK');
                      return res.status(400).json({ message: 'Invalid or expired token' });
                    }

                    db.run('COMMIT');
                    res.status(200).json({ message: 'Password reset successful' });
                  }
                );
              }
            );
          });
        } catch (error) {
          res.status(400).json({ message: 'Invalid or expired token' });
        }
      }
    );
  } catch (error) {
    res.status(400).json({ message: 'Invalid or expired token' });
  }
}));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error');
  res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
});