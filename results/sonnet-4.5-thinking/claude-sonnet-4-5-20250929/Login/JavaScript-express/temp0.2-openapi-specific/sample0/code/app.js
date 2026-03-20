require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Get APP_SECRET from environment variable (CWE-347)
const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
  console.error('APP_SECRET environment variable is not set');
  process.exit(1);
}

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table for rate limiting (CWE-307)
  db.run(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT NOT NULL,
      attempt_time INTEGER NOT NULL,
      PRIMARY KEY (email, attempt_time)
    )
  `);
});

// Rate limiting helper (CWE-307)
const checkRateLimit = (email) => {
  return new Promise((resolve, reject) => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    
    // Clean old attempts
    db.run(
      'DELETE FROM login_attempts WHERE attempt_time < ?',
      [fiveMinutesAgo],
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Count recent attempts
        db.get(
          'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time >= ?',
          [email, fiveMinutesAgo],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (row.count >= 5) {
              resolve(false); // Rate limit exceeded
            } else {
              resolve(true); // OK to proceed
            }
          }
        );
      }
    );
  });
};

const recordLoginAttempt = (email) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)',
      [email, Date.now()],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

const clearLoginAttempts = (email) => {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM login_attempts WHERE email = ?',
      [email],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
};

// Error handler middleware (CWE-209, CWE-703)
const errorHandler = (err, req, res, next) => {
  // Don't expose internal error details (CWE-209)
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
};

// Login endpoint
app.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Input validation (CWE-703)
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check rate limit (CWE-307)
    const canProceed = await checkRateLimit(email);
    if (!canProceed) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }

    // Use parameterized query to prevent SQL injection (CWE-89)
    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          return next(err);
        }

        // Generic error message to avoid user enumeration (CWE-209)
        if (!user) {
          await recordLoginAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        try {
          // Verify password (CWE-522)
          const validPassword = await bcrypt.compare(password, user.password);
          if (!validPassword) {
            await recordLoginAttempt(email);
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          // Clear login attempts on successful login
          await clearLoginAttempts(email);

          // Generate JWT token with expiration (CWE-345, CWE-347)
          const token = jwt.sign(
            { id: user.id, email: user.email },
            APP_SECRET,
            { 
              algorithm: 'HS256', // Explicitly set algorithm (CWE-345)
              expiresIn: '1h' // Add expiration (CWE-345)
            }
          );

          res.status(200).json({
            token: token,
            message: 'Login successful'
          });
        } catch (error) {
          next(error);
        }
      }
    );
  } catch (error) {
    next(error);
  }
});

// Registration endpoint
app.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // Input validation (CWE-703)
    if (!email || !password || !name || 
        typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Password strength check
    if (password.length < 6) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    try {
      // Hash password (CWE-522)
      const hashedPassword = await bcrypt.hash(password, 10);

      // Use parameterized query to prevent SQL injection (CWE-89)
      db.run(
        'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
        [email, hashedPassword, name],
        function(err) {
          if (err) {
            // Check for unique constraint violation (CWE-209)
            if (err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ message: 'Email already in use or invalid data' });
            }
            return next(err);
          }

          res.status(201).json({
            message: 'Registration successful'
          });
        }
      );
    } catch (error) {
      next(error);
    }
  } catch (error) {
    next(error);
  }
});

// Use error handler (CWE-703)
app.use(errorHandler);

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});