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
    console.error('Error opening database:', err.message);
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

// Middleware to authenticate JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// POST /register
app.post('/register', (req, res) => {
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

  bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), username.trim(), hash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(500).json({ message: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  });
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
    (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      bcrypt.compare(password, user.password_hash, (err, match) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        if (!match) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { userId: user.id, username: user.username, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        return res.status(200).json({ token, message: 'Login successful' });
      });
    }
  );
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;

  if (!username || secret === undefined || secret === null) {
    return res.status(400).json({ message: 'Invalid data' });
  }

  // Ensure the authenticated user matches the username
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const userId = req.user.userId;

  // Check if secret already exists for this user
  db.get('SELECT id FROM secrets WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (row) {
      // Update existing secret
      db.run(
        'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [secret, userId],
        function (err) {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }
          return res.status(200).json({ message: 'Secret has been set successfully' });
        }
      );
    } else {
      // Insert new secret
      db.run(
        'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
        [userId, secret],
        function (err) {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }
          return res.status(200).json({ message: 'Secret has been set successfully' });
        }
      );
    }
  });
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  // Ensure the authenticated user matches the username
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const userId = req.user.userId;

  db.get('SELECT secret FROM secrets WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!row) {
      return res.status(404).json({ message: 'No secret found' });
    }
    return res.status(200).json({ secret: row.secret });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});