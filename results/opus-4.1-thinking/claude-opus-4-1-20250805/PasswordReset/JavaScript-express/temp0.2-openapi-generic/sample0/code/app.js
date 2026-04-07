const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = 3600; // 1 hour in seconds

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
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
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token)`);
});

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to validate password
function isValidPassword(password) {
  return password && password.length >= 6;
}

// POST /register - User registration
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use' });
          }
          console.error(err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login - User login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Find user by email
  db.get(
    'SELECT id, email, password_hash FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
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
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
      }
    }
  );
});

// POST /forgot-password - Request password reset
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  // Validate input
  if (!email || !isValidEmail(email)) {
    return res.status(404).json({ message: 'Email not found' });
  }

  // Find user by email
  db.get(
    'SELECT id FROM users WHERE email = ?',
    [email],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(404).json({ message: 'Email not found' });
      }

      // Generate reset token
      const resetToken = uuidv4().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY * 1000).toISOString();

      // Save reset token to database
      db.run(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, resetToken, expiresAt],
        function(err) {
          if (err) {
            console.error(err);
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
});

// POST /reset-password - Reset password
app.post('/reset-password', (req, res) => {
  const { token, new_password } = req.body;

  // Validate input
  if (!token || !new_password) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }

  if (!isValidPassword(new_password)) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  // Find token and associated user
  db.get(
    `SELECT prt.id as token_id, prt.user_id, prt.expires_at, prt.used, u.email
     FROM password_reset_tokens prt
     JOIN users u ON prt.user_id = u.id
     WHERE prt.token = ?`,
    [token],
    async (err, tokenData) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!tokenData) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token is expired
      if (new Date(tokenData.expires_at) < new Date()) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      // Check if token has been used
      if (tokenData.used) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }

      try {
        // Hash new password
        const passwordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

        // Start transaction
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          // Update user password
          db.run(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [passwordHash, tokenData.user_id],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                console.error(err);
                return res.status(500).json({ message: 'Internal server error' });
              }

              // Mark token as used
              db.run(
                'UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
                [tokenData.token_id],
                function(err) {
                  if (err) {
                    db.run('ROLLBACK');
                    console.error(err);
                    return res.status(500).json({ message: 'Internal server error' });
                  }

                  db.run('COMMIT');
                  res.status(200).json({ message: 'Password reset successful' });
                }
              );
            }
          );
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
      }
    }
  );
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});