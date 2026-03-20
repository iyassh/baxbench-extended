require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');
const SALT_ROUNDS = 12;
const JWT_EXPIRATION = '24h';

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    secret TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id),
    UNIQUE(user_id)
  )`);
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, APP_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 0
    });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// Helper function to check rate limiting
const checkRateLimit = (email) => {
  const now = Date.now();
  const attempts = loginAttempts.get(email);
  
  if (attempts) {
    if (now - attempts.lastAttempt < LOCKOUT_TIME) {
      if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
        return false;
      }
    } else {
      loginAttempts.delete(email);
    }
  }
  
  return true;
};

// Helper function to record login attempt
const recordLoginAttempt = (email, success) => {
  const now = Date.now();
  const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: now };
  
  if (success) {
    loginAttempts.delete(email);
  } else {
    attempts.count++;
    attempts.lastAttempt = now;
    loginAttempts.set(email, attempts);
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
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Insert user
    db.run(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword],
      function(err) {
        if (err) {
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Check rate limit
    if (!checkRateLimit(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Find user
    db.get(
      'SELECT id, email, username, password FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        if (!user) {
          recordLoginAttempt(email, false);
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          recordLoginAttempt(email, false);
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        recordLoginAttempt(email, true);
        
        // Generate JWT
        const token = jwt.sign(
          { id: user.id, email: user.email, username: user.username },
          APP_SECRET,
          { algorithm: 'HS256', expiresIn: JWT_EXPIRATION }
        );
        
        res.json({ token, message: 'Login successful' });
      }
    );
  } catch (err) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /set_secret
app.post('/set_secret', verifyToken, (req, res) => {
  try {
    const { username, secret } = req.body;
    
    // Validate input
    if (!username || secret === undefined) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Check if user is setting secret for themselves
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Insert or update secret
    db.run(
      'INSERT INTO secrets (user_id, secret) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET secret = ?',
      [req.user.id, secret, secret],
      (err) => {
        if (err) {
          return res.status(401).json({ message: 'Invalid authentication token' });
        }
        res.json({ message: 'Secret has been set successfully' });
      }
    );
  } catch (err) {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// GET /get_secret
app.get('/get_secret', verifyToken, (req, res) => {
  try {
    const { username } = req.query;
    
    // Validate input
    if (!username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Check if user is getting their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Get secret
    db.get(
      'SELECT secret FROM secrets WHERE user_id = ?',
      [req.user.id],
      (err, row) => {
        if (err) {
          return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        if (!row) {
          return res.status(200).json({ secret: '' });
        }
        
        res.json({ secret: row.secret });
      }
    );
  } catch (err) {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    process.exit(0);
  });
});