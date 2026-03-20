const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// APP_SECRET with strong fallback (CWE-347)
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

// Ensure APP_SECRET is strong enough
if (APP_SECRET.length < 32) {
  console.error('APP_SECRET must be at least 32 characters long');
  process.exit(1);
}

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`);
});

// Rate limiting for brute force protection (CWE-307)
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email) {
  return new Promise((resolve, reject) => {
    const cutoff = Date.now() - LOCKOUT_DURATION_MS;
    db.get(
      `SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?`,
      [email, cutoff],
      (err, row) => {
        if (err) return reject(err);
        resolve(row.count < MAX_LOGIN_ATTEMPTS);
      }
    );
  });
}

function recordLoginAttempt(email) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)`,
      [email, Date.now()],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function clearLoginAttempts(email) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM login_attempts WHERE email = ?`,
      [email],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// CSRF token generation and validation (CWE-352)
function generateCsrfToken() {
  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.run(
      `INSERT INTO csrf_tokens (token, created_at) VALUES (?, ?)`,
      [token, Date.now()],
      (err) => {
        if (err) return reject(err);
        resolve(token);
      }
    );
  });
}

function validateCsrfToken(token) {
  return new Promise((resolve, reject) => {
    if (!token) return resolve(false);
    const cutoff = Date.now() - 3600000; // 1 hour expiry
    db.get(
      `SELECT token FROM csrf_tokens WHERE token = ? AND created_at > ?`,
      [token, cutoff],
      (err, row) => {
        if (err) return reject(err);
        if (row) {
          // Delete used token
          db.run(`DELETE FROM csrf_tokens WHERE token = ?`, [token]);
          resolve(true);
        } else {
          resolve(false);
        }
      }
    );
  });
}

// CSRF middleware for state-changing requests (CWE-352)
async function csrfProtection(req, res, next) {
  try {
    const csrfToken = req.headers['x-csrf-token'] || req.body._csrf;
    const isValid = await validateCsrfToken(csrfToken);
    if (!isValid) {
      return res.status(403).json({ message: 'Invalid or missing CSRF token' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// Endpoint to get CSRF token
app.get('/csrf-token', async (req, res) => {
  try {
    const token = await generateCsrfToken();
    // Set CSRF token as a cookie with proper flags (CWE-614, CWE-1275)
    res.cookie('csrf-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 3600000
    });
    res.json({ csrfToken: token });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Email validation
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === 'string' && emailRegex.test(email) && email.length <= 255;
}

// POST /login (CWE-522: passwords hashed with bcrypt, CWE-307: rate limiting)
app.post('/login', csrfProtection, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Rate limiting check (CWE-307)
    const allowed = await checkRateLimit(email);
    if (!allowed) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }

    // Find user using parameterized query (CWE-89)
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
      try {
        if (err) {
          // Don't expose internal errors (CWE-209)
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!user) {
          await recordLoginAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Compare password (CWE-522)
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          await recordLoginAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Clear login attempts on success
        await clearLoginAttempts(email);

        // Generate JWT with expiration (CWE-345: no 'none' algorithm, CWE-345: include exp)
        const token = jwt.sign(
          { userId: user.id, email: user.email },
          APP_SECRET,
          {
            algorithm: 'HS256',
            expiresIn: '1h'
          }
        );

        // Set token as httpOnly cookie (CWE-614, CWE-1275)
        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: 3600000
        });

        return res.status(200).json({ token, message: 'Login successful' });
      } catch (innerErr) {
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /register
app.post('/register', csrfProtection, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Input validation
    if (!email || !password || !name ||
        typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (name.trim().length === 0 || name.length > 255) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password with bcrypt (CWE-522)
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user using parameterized query (CWE-89)
    db.run(
      `INSERT INTO users (email, password, name) VALUES (?, ?, ?)`,
      [email, hashedPassword, name.trim()],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          // CWE-209: Don't expose internal error details
          return res.status(500).json({ message: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    // CWE-209, CWE-703
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// JWT verification middleware (CWE-345: reject 'none' algorithm, CWE-347: verify signature)
function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const tokenFromCookie = req.cookies && req.cookies.token;
    const token = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) || tokenFromCookie;

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Verify with explicit algorithms to prevent 'none' algorithm attack (CWE-345)
    jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      req.user = decoded;
      next();
    });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  // Don't expose internal error details
  res.status(500).json({ message: 'Internal server error' });
});

// Clean up old login attempts and CSRF tokens periodically
setInterval(() => {
  const cutoff = Date.now() - LOCKOUT_DURATION_MS;
  db.run(`DELETE FROM login_attempts WHERE attempt_time < ?`, [cutoff]);
  const csrfCutoff = Date.now() - 3600000;
  db.run(`DELETE FROM csrf_tokens WHERE created_at < ?`, [csrfCutoff]);
}, 60000);

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

module.exports = app;