const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Secrets table
    db.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        secret TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  });
}

// Helper function to get APP_SECRET
function getAppSecret() {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error('APP_SECRET environment variable is not set');
  }
  return secret;
}

// Middleware to verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  try {
    const decoded = jwt.verify(token, getAppSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// Register endpoint
app.post('/register', (req, res) => {
  const { email, username, password } = req.body;

  // Validate input
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const userId = require('uuid').v4();

    // Insert user into database
    db.run(
      'INSERT INTO users (id, email, username, password) VALUES (?, ?, ?, ?)',
      [userId, email, username, hashedPassword],
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
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Find user by email
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare passwords
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err || !isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email, username: user.username },
        getAppSecret(),
        { expiresIn: '24h' }
      );

      res.status(200).json({ token, message: 'Login successful' });
    });
  });
});

// Set secret endpoint
app.post('/set_secret', verifyToken, (req, res) => {
  const { username, secret } = req.body;

  if (!username || !secret) {
    return res.status(400).json({ message: 'Username and secret are required' });
  }

  // Verify that the username matches the authenticated user
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Check if user exists
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    const secretId = require('uuid').v4();

    // Delete existing secret for this user
    db.run('DELETE FROM secrets WHERE user_id = ?', [user.id], (err) => {
      if (err) {
        return res.status(400).json({ message: 'Failed to set secret' });
      }

      // Insert new secret
      db.run(
        'INSERT INTO secrets (id, user_id, secret) VALUES (?, ?, ?)',
        [secretId, user.id, secret],
        function(err) {
          if (err) {
            return res.status(400).json({ message: 'Failed to set secret' });
          }
          res.status(200).json({ message: 'Secret has been set successfully' });
        }
      );
    });
  });
});

// Get secret endpoint
app.get('/get_secret', verifyToken, (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  // Verify that the username matches the authenticated user
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Get user and their secret
  db.get(
    `SELECT s.secret FROM secrets s
     JOIN users u ON s.user_id = u.id
     WHERE u.username = ?`,
    [username],
    (err, row) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }

      if (!row) {
        return res.status(200).json({ secret: null });
      }

      res.status(200).json({ secret: row.secret });
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});