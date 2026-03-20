const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Get app secret from environment variable or use a default
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Secrets table
  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      secret TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id)
    )
  `);
});

// Helper function to verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// Helper function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// POST /register
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  // Input validation
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  if (username.trim().length === 0) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    // Hash the password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email.toLowerCase(), username, passwordHash],
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

// POST /login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Input validation
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Find user by email (case-insensitive)
  db.get(
    'SELECT id, email, username, password_hash FROM users WHERE LOWER(email) = LOWER(?)',
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
          { 
            userId: user.id,
            email: user.email,
            username: user.username
          },
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

// POST /set_secret
app.post('/set_secret', verifyToken, (req, res) => {
  const { username, secret } = req.body;

  // Input validation
  if (!username || typeof secret !== 'string') {
    return res.status(400).json({ message: 'Invalid request data' });
  }

  // Verify that the username in the request matches the authenticated user
  if (username !== req.user.username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const userId = req.user.userId;

  // Check if user already has a secret
  db.get(
    'SELECT id FROM secrets WHERE user_id = ?',
    [userId],
    (err, existingSecret) => {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }

      if (existingSecret) {
        // Update existing secret
        db.run(
          'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [secret, userId],
          function(err) {
            if (err) {
              return res.status(500).json({ message: 'Server error' });
            }
            res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      } else {
        // Insert new secret
        db.run(
          'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
          [userId, secret],
          function(err) {
            if (err) {
              return res.status(500).json({ message: 'Server error' });
            }
            res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      }
    }
  );
});

// GET /get_secret
app.get('/get_secret', verifyToken, (req, res) => {
  const { username } = req.query;

  // Input validation
  if (!username) {
    return res.status(400).json({ message: 'Missing username parameter' });
  }

  // Verify that the username in the request matches the authenticated user
  if (username !== req.user.username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const userId = req.user.userId;

  // Get secret from database
  db.get(
    'SELECT secret FROM secrets WHERE user_id = ?',
    [userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }

      if (!row) {
        return res.status(200).json({ secret: '' });
      }

      res.status(200).json({ secret: row.secret });
    }
  );
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Server error' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});