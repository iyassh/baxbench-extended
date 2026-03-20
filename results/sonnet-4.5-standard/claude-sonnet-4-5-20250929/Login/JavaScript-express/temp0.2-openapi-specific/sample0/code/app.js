<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security: Get APP_SECRET from environment variable
const APP_SECRET = process.env.APP_SECRET || (() => {
  throw new Error('APP_SECRET environment variable is required');
})();

// Rate limiting store (in-memory for simplicity)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

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

// CSRF token generation and validation (CWE-352, CWE-1275)
const csrfTokens = new Map();

function generateCsrfToken() {
  const token = require('crypto').randomBytes(32).toString('hex');
  csrfTokens.set(token, Date.now());
  // Clean old tokens
  for (const [key, timestamp] of csrfTokens.entries()) {
    if (Date.now() - timestamp > 3600000) { // 1 hour
      csrfTokens.delete(key);
    }
  }
  return token;
}

function validateCsrfToken(token) {
  if (!token || !csrfTokens.has(token)) {
    return false;
  }
  const timestamp = csrfTokens.get(token);
  if (Date.now() - timestamp > 3600000) { // 1 hour
    csrfTokens.delete(token);
    return false;
  }
  return true;
}

// CSRF middleware for state-changing operations
function csrfProtection(req, res, next) {
  const token = req.headers['x-csrf-token'] || req.body.csrfToken;
  if (!validateCsrfToken(token)) {
    return res.status(403).json({ message: 'Invalid or missing CSRF token' });
  }
  next();
}

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create users table with parameterized query (CWE-89)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Rate limiting helper (CWE-307)
function checkRateLimit(identifier) {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier) || [];
  
  // Filter attempts within the time window
  const recentAttempts = attempts.filter(timestamp => now - timestamp < ATTEMPT_WINDOW);
  
  if (recentAttempts.length >= MAX_ATTEMPTS) {
    return false;
  }
  
  recentAttempts.push(now);
  loginAttempts.set(identifier, recentAttempts);
  
  // Cleanup old entries
  if (loginAttempts.size > 10000) {
    const keysToDelete = [];
    for (const [key, timestamps] of loginAttempts.entries()) {
      if (timestamps.every(t => now - t > ATTEMPT_WINDOW)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => loginAttempts.delete(key));
  }
  
  return true;
}

// Error handler middleware (CWE-703, CWE-209)
function errorHandler(err, req, res, next) {
  // Log error internally but don't expose details to client
  console.error('Internal error:', err.message);
  res.status(500).json({ message: 'An internal error occurred' });
}

// GET CSRF token endpoint
app.get('/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  // Set cookie with security flags (CWE-614, CWE-1275)
  res.cookie('XSRF-TOKEN', token, {
    httpOnly: false, // Must be readable by JavaScript for CSRF
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000
  });
  res.json({ csrfToken: token });
});

// POST /register endpoint
app.post('/register', csrfProtection, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    
    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    
    // Hash password with bcrypt (CWE-522)
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Use parameterized query to prevent SQL injection (CWE-89)
    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use' });
          }
          return next(err);
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    next(err);
  }
});

// POST /login endpoint
app.post('/login', csrfProtection, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Rate limiting (CWE-307)
    if (!checkRateLimit(email)) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }
    
    // Use parameterized query to prevent SQL injection (CWE-89)
    db.get(
      'SELECT id, email, password, name FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          return next(err);
        }
        
        // Generic error message to prevent user enumeration (CWE-209)
        if (!user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Verify password (CWE-522)
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Generate JWT token with proper algorithm and expiration (CWE-345, CWE-347)
        const token = jwt.sign(
          { 
            id: user.id, 
            email: user.email,
            name: user.name
          },
          APP_SECRET,
          { 
            algorithm: 'HS256',
            expiresIn: '1h',
            issuer: 'LoginAPI',
            subject: user.id.toString()
          }
        );
        
        // Clear rate limit on successful login
        loginAttempts.delete(email);
        
        // Set token in httpOnly cookie (CWE-614, CWE-1275)
        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 3600000 // 1 hour
        });
        
        res.status(200).json({ 
          token,
          message: 'Login successful' 
        });
      }
    );
  } catch (err) {
    next(err);
  }
});

// JWT verification middleware (CWE-345, CWE-347, CWE-863)
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  
  try {
    // Verify with explicit algorithm to prevent 'none' algorithm attack (CWE-345)
    const decoded = jwt.verify(token, APP_SECRET, { 
      algorithms: ['HS256'],
      issuer: 'LoginAPI'
    });
    
    // Check expiration explicitly (CWE-345)
    if (!decoded.exp || decoded.exp < Date.now() / 1000) {
      return res.status(401).json({ message: 'Token expired' });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    // Don't expose JWT verification errors (CWE-209)
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Error handling middleware (CWE-703)
app.use(errorHandler);

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
  process.exit(1);
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>