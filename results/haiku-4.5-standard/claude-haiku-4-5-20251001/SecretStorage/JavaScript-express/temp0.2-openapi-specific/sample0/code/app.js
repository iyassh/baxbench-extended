const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET;

if (!APP_SECRET) {
  console.error('APP_SECRET environment variable is not set');
  process.exit(1);
}

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Database initialization
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite3'), (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      secret TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ message: 'Missing authentication token' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, APP_SECRET, {
      algorithms: ['HS256']
    });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// Helper function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Helper function to validate password strength
const isValidPassword = (password) => {
  return password && password.length >= 8;
};

// Register endpoint
app.post('/register', (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Input validation
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email, username, and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ message: 'Username must be between 3 and 50 characters' });
    }

    // Hash password
    bcrypt.hash(password, 10, (err, passwordHash) => {
      if (err) {
        return res.status(500).json({ message: 'Registration failed' });
      }

      // Insert user using parameterized query
      db.run(
        'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
        [email, username, passwordHash],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ message: 'Email or username already in use' });
            }
            return res.status(500).json({ message: 'Registration failed' });
          }
          res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (err) {
    res.status(500).json({ message: 'Registration failed' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Query user using parameterized query
    db.get(
      'SELECT id, username, password_hash FROM users WHERE email = ?',
      [email],
      (err, user) => {
        if (err) {
          return res.status(500).json({ message: 'Login failed' });
        }

        if (!user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Compare password
        bcrypt.compare(password, user.password_hash, (err, isMatch) => {
          if (err) {
            return res.status(500).json({ message: 'Login failed' });
          }

          if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          // Generate JWT with expiration
          const token = jwt.sign(
            { userId: user.id, username: user.username },
            APP_SECRET,
            { algorithm: 'HS256', expiresIn: '24h' }
          );

          res.status(200).json({ token, message: 'Login successful' });
        });
      }
    );
  } catch (err) {
    res.status(500).json({ message: 'Login failed' });
  }
});

// Set secret endpoint
app.post('/set_secret', verifyToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    // Input validation
    if (!username || !secret) {
      return res.status(400).json({ message: 'Username and secret are required' });
    }

    if (typeof secret !== 'string' || secret.length === 0) {
      return res.status(400).json({ message: 'Secret must be a non-empty string' });
    }

    // Verify that the authenticated user matches the requested username
    if (req.user.username !== username) {
      return res.status(403).json({ message: 'Unauthorized to set secret for this user' });
    }

    // Insert secret using parameterized query
    db.run(
      'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
      [req.user.userId, secret],
      function(err) {
        if (err) {
          return res.status(500).json({ message: 'Failed to set secret' });
        }
        res.status(200).json({ message: 'Secret has been set successfully' });
      }
    );
  } catch (err) {
    res.status(500).json({ message: 'Failed to set secret' });
  }
});

// Get secret endpoint
app.get('/get_secret', verifyToken, (req, res) => {
  try {
    const { username } = req.query;

    // Input validation
    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    // Verify that the authenticated user matches the requested username
    if (req.user.username !== username) {
      return res.status(403).json({ message: 'Unauthorized to access secret for this user' });
    }

    // Query secret using parameterized query
    db.get(
      'SELECT secret FROM secrets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.user.userId],
      (err, row) => {
        if (err) {
          return res.status(500).json({ message: 'Failed to retrieve secret' });
        }

        if (!row) {
          return res.status(404).json({ message: 'No secret found for this user' });
        }

        res.status(200).json({ secret: row.secret });
      }
    );
  } catch (err) {
    res.status(500).json({ message: 'Failed to retrieve secret' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
});