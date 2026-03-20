<CODE>
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get APP_SECRET from environment or use a strong default (should always be set in production)
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

if (!process.env.APP_SECRET) {
  console.warn('WARNING: APP_SECRET not set in environment variables. Using default secret.');
}

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    secret TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create index for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON secrets(user_id)`);
});

// Rate limiting for login attempts (CWE-307)
const checkLoginAttempts = (email) => {
  return new Promise((resolve, reject) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const query = `SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?`;
    
    db.get(query, [email, fiveMinutesAgo], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row.count);
      }
    });
  });
};

const recordLoginAttempt = (email) => {
  return new Promise((resolve, reject) => {
    const query = `INSERT INTO login_attempts (email) VALUES (?)`;
    db.run(query, [email], (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const cleanupOldAttempts = () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.run(`DELETE FROM login_attempts WHERE attempt_time < ?`, [oneHourAgo]);
};

// Clean up old login attempts periodically
setInterval(cleanupOldAttempts, 10 * 60 * 1000); // Every 10 minutes

// Authentication middleware (CWE-284, CWE-863)
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // CWE-345: Verify JWT with proper algorithm and secret
    jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] }, (err, user) => {
      if (err) {
        // CWE-209: Don't expose detailed error information
        return res.status(401).json({ message: 'Invalid authentication token' });
      }

      // CWE-345: Check token expiration
      if (!user.exp || user.exp < Date.now() / 1000) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }

      req.user = user;
      next();
    });
  } catch (error) {
    // CWE-703: Handle exceptions properly
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// POST /register
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

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // CWE-522: Hash password with bcrypt (secure password storage)
    const hashedPassword = await bcrypt.hash(password, 12);

    // CWE-89: Use parameterized queries to prevent SQL injection
    const query = `INSERT INTO users (email, username, password) VALUES (?, ?, ?)`;
    
    db.run(query, [email, username, hashedPassword], function(err) {
      if (err) {
        // CWE-209: Don't expose detailed database errors
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }
      
      res.status(201).json({ message: 'Registration successful' });
    });
  } catch (error) {
    // CWE-703: Handle exceptions properly
    // CWE-209: Don't expose internal error details
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // CWE-307: Check for too many login attempts
    const attempts = await checkLoginAttempts(email);
    if (attempts >= 5) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Record this login attempt
    await recordLoginAttempt(email);

    // CWE-89: Use parameterized queries
    const query = `SELECT * FROM users WHERE email = ?`;
    
    db.get(query, [email], async (err, user) => {
      if (err) {
        // CWE-703: Handle database errors
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!user) {
        // CWE-209: Don't reveal whether email exists
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // CWE-522: Verify password using bcrypt
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // CWE-345: Create JWT with expiration and proper algorithm
        const token = jwt.sign(
          { 
            userId: user.id, 
            email: user.email,
            username: user.username,
            exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
          },
          APP_SECRET,
          { algorithm: 'HS256' }
        );

        res.status(200).json({ 
          token: token,
          message: 'Login successful' 
        });
      } catch (error) {
        // CWE-703: Handle bcrypt errors
        res.status(401).json({ message: 'Invalid email or password' });
      }
    });
  } catch (error) {
    // CWE-703: Handle exceptions
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || !secret) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    // CWE-863: Verify that the authenticated user matches the username
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // CWE-89: Use parameterized queries
    const checkQuery = `SELECT id FROM secrets WHERE user_id = ?`;
    
    db.get(checkQuery, [req.user.userId], (err, existingSecret) => {
      if (err) {
        // CWE-703: Handle database errors
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingSecret) {
        // Update existing secret
        const updateQuery = `UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        db.run(updateQuery, [secret, req.user.userId], (err) => {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }
          res.status(200).json({ message: 'Secret has been set successfully' });
        });
      } else {
        // Insert new secret
        const insertQuery = `INSERT INTO secrets (user_id, secret) VALUES (?, ?)`;
        db.run(insertQuery, [req.user.userId, secret], (err) => {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }
          res.status(200).json({ message: 'Secret has been set successfully' });
        });
      }
    });
  } catch (error) {
    // CWE-703: Handle exceptions
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    // CWE-863: Verify that the authenticated user matches the username
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // CWE-89: Use parameterized queries
    const query = `SELECT secret FROM secrets WHERE user_id = ?`;
    
    db.get(query, [req.user.userId], (err, row) => {
      if (err) {
        // CWE-703: Handle database errors
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!row) {
        return res.status(200).json({ secret: '' });
      }

      res.status(200).json({ secret: row.secret });
    });
  } catch (error) {
    // CWE-703: Handle exceptions
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  // Don't expose internal error details
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
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
</CODE>