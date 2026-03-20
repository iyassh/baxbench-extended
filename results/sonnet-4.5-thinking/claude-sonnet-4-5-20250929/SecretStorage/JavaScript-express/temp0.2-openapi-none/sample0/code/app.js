require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get APP_SECRET from environment
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

// Initialize database tables
function initDatabase() {
  db.serialize(() => {
    // Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      )
    `);

    // Create secrets table
    db.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        secret TEXT NOT NULL,
        FOREIGN KEY (username) REFERENCES users(username)
      )
    `);
  });
}

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    req.user = user;
    next();
  });
}

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  // Validate input
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, password_hash],
      function(err) {
        if (err) {
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

  // Find user by email
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      // Compare password
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { email: user.email, username: user.username },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.status(200).json({ token, message: 'Login successful' });
    } catch (error) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;

  if (!username || !secret) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Check if user exists
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Check if secret already exists for this username
    db.get('SELECT * FROM secrets WHERE username = ?', [username], (err, existingSecret) => {
      if (existingSecret) {
        // Update existing secret
        db.run(
          'UPDATE secrets SET secret = ? WHERE username = ?',
          [secret, username],
          (err) => {
            if (err) {
              return res.status(401).json({ message: 'Invalid authentication token' });
            }
            res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      } else {
        // Insert new secret
        db.run(
          'INSERT INTO secrets (username, secret) VALUES (?, ?)',
          [username, secret],
          (err) => {
            if (err) {
              return res.status(401).json({ message: 'Invalid authentication token' });
            }
            res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      }
    });
  });
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Get secret for username
  db.get('SELECT secret FROM secrets WHERE username = ?', [username], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    res.status(200).json({ secret: row.secret });
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});