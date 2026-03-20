require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    secret TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7);

  if (!token) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  if (typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), username.trim(), passwordHash],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email.toLowerCase().trim()],
    async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        // Still compare to prevent timing attacks
        await bcrypt.compare(password, '$2b$12$invalidhashfortimingattackprevention000000000000000000');
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { userId: user.id, username: user.username, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        return res.status(200).json({ token, message: 'Login successful' });
      } catch (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
    }
  );
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;

  if (!username || secret === undefined || secret === null) {
    return res.status(400).json({ message: 'Invalid data' });
  }

  // Ensure the authenticated user can only set their own secret
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Check if secret already exists for this user
    db.get('SELECT id FROM secrets WHERE user_id = ?', [user.id], (err, existingSecret) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingSecret) {
        db.run(
          'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [secret, user.id],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Internal server error' });
            }
            return res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      } else {
        db.run(
          'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
          [user.id, secret],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Internal server error' });
            }
            return res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      }
    });
  });
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  // Ensure the authenticated user can only get their own secret
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.get('SELECT secret FROM secrets WHERE user_id = ?', [user.id], (err, secretRow) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!secretRow) {
        return res.status(200).json({ secret: null });
      }

      return res.status(200).json({ secret: secretRow.secret });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;