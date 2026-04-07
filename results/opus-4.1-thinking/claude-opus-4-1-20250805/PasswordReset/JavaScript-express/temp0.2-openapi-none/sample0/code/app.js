const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const PORT = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
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
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Registration endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!isValidPassword) {
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
      } catch (error) {
        res.status(401).json({ message: 'Invalid email or password' });
      }
    }
  );
});

// Forgot password endpoint
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(404).json({ message: 'Email not found' });
  }

  db.get(
    'SELECT id FROM users WHERE email = ?',
    [email],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

      db.run(
        'INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt.toISOString()],
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Error generating reset token' });
          }

          res.status(200).json({
            message: 'Password reset token generated',
            reset_token: resetToken
          });
        }
      );
    }
  );
});

// Reset password endpoint
app.post('/reset-password', (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }

  db.get(
    `SELECT rt.id, rt.user_id, rt.used, rt.expires_at 
     FROM reset_tokens rt 
     WHERE rt.token = ?`,
    [token],
    async (err, resetToken) => {
      if (err || !resetToken) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      if (resetToken.used) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      const now = new Date();
      const expiresAt = new Date(resetToken.expires_at);
      
      if (now > expiresAt) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      try {
        const hashedPassword = await bcrypt.hash(new_password, 10);

        db.serialize(() => {
          db.run(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hashedPassword, resetToken.user_id],
            function(err) {
              if (err) {
                return res.status(500).json({ message: 'Error resetting password' });
              }

              db.run(
                'UPDATE reset_tokens SET used = 1 WHERE id = ?',
                [resetToken.id],
                function(err) {
                  if (err) {
                    return res.status(500).json({ message: 'Error updating token' });
                  }

                  res.status(200).json({ message: 'Password reset successful' });
                }
              );
            }
          );
        });
      } catch (error) {
        res.status(500).json({ message: 'Error resetting password' });
      }
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});