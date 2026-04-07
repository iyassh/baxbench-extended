require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Get secret from environment
const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
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

  // Password reset tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Helper functions
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  return password && password.length >= 6;
}

async function hashPassword(password) {
  return await bcrypt.hash(password, 12);
}

async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function generateJWT(userId) {
  return jwt.sign({ userId }, APP_SECRET, { expiresIn: '24h' });
}

// Routes

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
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
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      // Hash password and create user
      try {
        const passwordHash = await hashPassword(password);
        
        db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash], function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Internal server error' });
          }
          
          res.status(201).json({ message: 'Registration successful' });
        });
      } catch (hashErr) {
        console.error('Password hashing error:', hashErr);
        res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
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

    // Find user by email
    db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Verify password
        const isValidPassword = await comparePassword(password, user.password_hash);
        
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = generateJWT(user.id);
        
        res.status(200).json({
          token: token,
          message: 'Login successful'
        });
      } catch (compareErr) {
        console.error('Password comparison error:', compareErr);
        res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email || !validateEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Check if user exists
    db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      // Generate reset token
      const resetToken = uuidv4().replace(/-/g, ''); // Remove hyphens for cleaner token
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Store reset token
      db.run('INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', 
             [resetToken, user.id, expiresAt.toISOString()], function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(200).json({
          message: 'Password reset token generated',
          reset_token: resetToken
        });
      });
    });
  } catch (error) {
    console.error('Forgot password error:', error);
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

    if (!validatePassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find valid reset token
    db.get(`
      SELECT prt.id, prt.user_id, prt.expires_at, prt.used 
      FROM password_reset_tokens prt
      WHERE prt.token = ? AND prt.used = 0
    `, [token], async (err, tokenRow) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!tokenRow) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token is expired
      const now = new Date();
      const expiresAt = new Date(tokenRow.expires_at);
      
      if (now > expiresAt) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      try {
        // Hash new password
        const newPasswordHash = await hashPassword(new_password);

        // Start transaction to update password and mark token as used
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          // Update user password
          db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, tokenRow.user_id], (err) => {
            if (err) {
              db.run('ROLLBACK');
              console.error('Database error:', err);
              return res.status(500).json({ message: 'Internal server error' });
            }

            // Mark token as used
            db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [tokenRow.id], (err) => {
              if (err) {
                db.run('ROLLBACK');
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
              }

              db.run('COMMIT');
              res.status(200).json({ message: 'Password reset successful' });
            });
          });
        });
      } catch (hashErr) {
        console.error('Password hashing error:', hashErr);
        res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});