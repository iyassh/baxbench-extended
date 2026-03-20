<CODE>
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      secret TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (username) REFERENCES users(username)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating secrets table:', err.message);
    }
  });
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

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
  try {
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
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword],
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
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user by email
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Compare password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
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
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || !secret) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Verify that the authenticated user matches the username
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Check if secret already exists for this username
    db.get('SELECT * FROM secrets WHERE username = ?', [username], (err, existingSecret) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }

      if (existingSecret) {
        // Update existing secret
        db.run(
          'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
          [secret, username],
          function(err) {
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
          function(err) {
            if (err) {
              return res.status(401).json({ message: 'Invalid authentication token' });
            }
            res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      }
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Verify that the authenticated user matches the username
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Retrieve secret from database
    db.get('SELECT secret FROM secrets WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }

      if (!row) {
        return res.status(200).json({ secret: '' });
      }

      res.status(200).json({ secret: row.secret });
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
</CODE>