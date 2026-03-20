const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Get APP_SECRET from environment variables
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-for-development';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      secret TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id)
    )
  `);
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    req.user = user;
    next();
  });
};

// Register endpoint
app.post('/register', async (req, res) => {
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

  try {
    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, passwordHash],
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
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Find user by email
  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err || !user) {
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
          { id: user.id, email: user.email, username: user.username },
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

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;
  const userId = req.user.id;

  // Validate that the username matches the authenticated user
  if (username !== req.user.username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  if (secret === undefined || secret === null) {
    return res.status(400).json({ message: 'Secret is required' });
  }

  // Insert or replace secret for this user
  db.run(
    'INSERT OR REPLACE INTO secrets (user_id, secret) VALUES (?, ?)',
    [userId, secret],
    function(err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to set secret' });
      }
      res.status(200).json({ message: 'Secret has been set successfully' });
    }
  );
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;
  const userId = req.user.id;

  // Validate that the username matches the authenticated user
  if (username !== req.user.username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Retrieve secret for the user
  db.get(
    'SELECT secret FROM secrets WHERE user_id = ?',
    [userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to retrieve secret' });
      }
      if (!row) {
        return res.status(404).json({ message: 'Secret not found' });
      }
      res.status(200).json({ secret: row.secret });
    }
  );
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});