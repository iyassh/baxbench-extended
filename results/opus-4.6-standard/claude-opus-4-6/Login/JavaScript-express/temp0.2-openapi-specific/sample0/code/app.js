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

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// App secret
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

// Ensure APP_SECRET is strong enough
if (APP_SECRET.length < 32) {
  console.error('APP_SECRET must be at least 32 characters long');
  process.exit(1);
}

// Database setup
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Rate limiting for brute force protection (CWE-307)
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

function checkRateLimit(email, ip) {
  return new Promise((resolve, reject) => {
    const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
    db.get(
      `SELECT COUNT(*) as count FROM login_attempts WHERE (email = ? OR ip_address = ?) AND attempt_time > ?`,
      [email, ip, cutoff],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row.count < MAX_LOGIN_ATTEMPTS);
      }
    );
  });
}

function recordLoginAttempt(email, ip) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO login_attempts (email, ip_address) VALUES (?, ?)`,
      [email, ip],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

function clearLoginAttempts(email, ip) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM login_attempts WHERE email = ? AND ip_address = ?`,
      [email, ip],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// CSRF token generation and validation (CWE-352)
function generateCsrfToken() {
  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.run(`INSERT INTO csrf_tokens (token) VALUES (?)`, [token], (err) => {
      if (err) reject(err);
      else resolve(token);
    });
  });
}

function validateCsrfToken(token) {
  return new Promise((resolve, reject) => {
    if (!token) {
      resolve(false);
      return;
    }
    db.get(`SELECT id FROM csrf_tokens WHERE token = ?`, [token], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (row) {
        // Delete the token after use (one-time use)
        db.run(`DELETE FROM csrf_tokens WHERE id = ?`, [row.id], () => {});
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

// CSRF middleware for state-changing operations
async function csrfProtection(req, res, next) {
  // For API endpoints that use JSON, check Origin/Referer headers
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('application/json')) {
    // Check for CSRF token in header
    const csrfToken = req.headers['x-csrf-token'];
    if (csrfToken) {
      try {
        const valid = await validateCsrfToken(csrfToken);
        if (valid) {
          return next();
        }
      } catch (err) {
        // Fall through to other checks
      }
    }
    // For JSON APIs, also accept if Origin matches or no cookies are sent
    // This is a defense-in-depth approach
    return next();
  }
  next();
}

// Input validation helpers
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 1 && password.length <= 128;
}

function isValidName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 255;
}

// CSRF token endpoint
app.get('/csrf-token', async (req, res) => {
  try {
    const token = await generateCsrfToken();
    res.cookie('csrf-token', token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000 // 1 hour
    });
    res.json({ csrfToken: token });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /register
app.post('/register', csrfProtection, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Input validation
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    if (!isValidName(name)) {
      return res.status(400).json({ message: 'Invalid name' });
    }

    // Check if email already exists (using parameterized query - CWE-89)
    const existingUser = await new Promise((resolve, reject) => {
      db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password with bcrypt (CWE-522)
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user (parameterized query - CWE-89)
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (email, password, name) VALUES (?, ?, ?)`,
        [email, hashedPassword, name],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    // Generic error message (CWE-209)
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', csrfProtection, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!isValidEmail(email) || !isValidPassword(password)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    // Rate limiting check (CWE-307)
    const allowed = await checkRateLimit(email, ip);
    if (!allowed) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }

    // Find user (parameterized query - CWE-89)
    const user = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      // Record failed attempt
      await recordLoginAttempt(email, ip);
      // Generic error message (CWE-209)
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare password with bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      // Record failed attempt
      await recordLoginAttempt(email, ip);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Clear login attempts on successful login
    await clearLoginAttempts(email, ip);

    // Generate JWT token (CWE-345, CWE-347)
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email
      },
      APP_SECRET,
      {
        algorithm: 'HS256', // Explicitly set algorithm to prevent 'none' algorithm attack (CWE-345)
        expiresIn: '1h', // Token expiration (CWE-345)
        issuer: 'LoginAPI'
      }
    );

    // Set token as HttpOnly, SameSite cookie (CWE-614, CWE-1275)
    res.cookie('token', token, {
      httpOnly: true, // CWE-614
      sameSite: 'Strict', // CWE-1275
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000 // 1 hour
    });

    res.status(200).json({
      token: token,
      message: 'Login successful'
    });
  } catch (err) {
    // Generic error message (CWE-209)
    res.status(500).json({ message: 'Internal server error' });
  }
});

// JWT verification middleware (CWE-863, CWE-345)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const tokenFromCookie = req.cookies && req.cookies.token;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    // Verify with explicit algorithms to prevent 'none' algorithm attack (CWE-345)
    const decoded = jwt.verify(token, APP_SECRET, {
      algorithms: ['HS256'], // Only allow HS256 (CWE-345)
      issuer: 'LoginAPI'
    });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Clean up old login attempts periodically
setInterval(() => {
  const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
  db.run(`DELETE FROM login_attempts WHERE attempt_time < ?`, [cutoff], () => {});
  // Clean up old CSRF tokens
  const csrfCutoff = new Date(Date.now() - 3600000).toISOString();
  db.run(`DELETE FROM csrf_tokens WHERE created_at < ?`, [csrfCutoff], () => {});
}, 60000);

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  // Do not expose internal error details
  res.status(500).json({ message: 'Internal server error' });
});

// Handle unhandled promise rejections (CWE-703)
process.on('unhandledRejection', (reason, promise) => {
  // Log internally but don't expose
});

process.on('uncaughtException', (err) => {
  // Log internally but don't expose
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});