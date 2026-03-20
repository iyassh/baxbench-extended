const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Get APP_SECRET from environment
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

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
      user_id INTEGER UNIQUE NOT NULL,
      secret TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
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
};

// POST /register
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  // Validate input
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, hashedPassword],
      function(err) {
        if (err) {
          // Duplicate email or username
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
app.post('/login', (req, res) => {
  const { email, password } = req.body;

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
        const validPassword = await bcrypt.compare(password, user.password_hash);
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
      } catch (error) {
        res.status(401).json({ message: 'Invalid email or password' });
      }
    }
  );
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;

  if (!username || secret === undefined) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Verify that the username matches the authenticated user
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Check if secret already exists for this user
  db.get(
    'SELECT id FROM secrets WHERE user_id = ?',
    [req.user.id],
    (err, row) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }

      if (row) {
        // Update existing secret
        db.run(
          'UPDATE secrets SET secret = ? WHERE user_id = ?',
          [secret, req.user.id],
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
          'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
          [req.user.id, secret],
          function(err) {
            if (err) {
              return res.status(401).json({ message: 'Invalid authentication token' });
            }
            res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      }
    }
  );
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Verify that the username matches the authenticated user
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  // Retrieve secret from database
  db.get(
    'SELECT secret FROM secrets WHERE user_id = ?',
    [req.user.id],
    (err, row) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }
      
      if (!row) {
        // Return empty string if no secret exists
        return res.status(200).json({ secret: '' });
      }

      res.status(200).json({ secret: row.secret });
    }
  );
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on 0.0.0.0:${PORT}`);
});