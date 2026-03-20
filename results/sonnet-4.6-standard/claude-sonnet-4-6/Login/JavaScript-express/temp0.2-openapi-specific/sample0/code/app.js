'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Use APP_SECRET from environment, ensure it's strong
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

// Rate limiting store (in-memory)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create users table with parameterized schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Failed to create users table');
      process.exit(1);
    }
  });
});

// Middleware
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Rate limiting middleware for login
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, { count: 0, firstAttempt: now });
  }
  
  const record = loginAttempts.get(ip);
  
  // Reset if window has passed
  if (now - record.firstAttempt > WINDOW_MS) {
    record.count = 0;
    record.firstAttempt = now;
  }
  
  if (record.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
  }
  
  record.count++;
  next();
}

// Helper to run db queries as promises
function dbGet(query, params) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(query, params) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// POST /login
app.post('/login', rateLimitLogin, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    if (email.length > 254 || password.length > 128) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Use parameterized query to prevent SQL injection
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    
    if (!user) {
      // Use constant-time comparison to prevent timing attacks
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingattackprevention000000000000000000000');
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Reset login attempts on success
    const ip = req.ip || req.connection.remoteAddress;
    loginAttempts.delete(ip);
    
    // Generate JWT with expiration, specifying algorithm explicitly
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      APP_SECRET,
      { 
        expiresIn: '1h',
        algorithm: 'HS256'
      }
    );
    
    // Set secure cookie with HttpOnly and SameSite flags
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000 // 1 hour
    });
    
    return res.status(200).json({ 
      token: token,
      message: 'Login successful' 
    });
    
  } catch (err) {
    console.error('Login error occurred');
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    // Input validation
    if (!email || !password || !name || 
        typeof email !== 'string' || 
        typeof password !== 'string' || 
        typeof name !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    if (email.length > 254 || password.length > 128 || name.length > 100) {
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
    
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if email already exists using parameterized query
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Hash password with bcrypt (cost factor 12)
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Insert new user with parameterized query
    await dbRun(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [normalizedEmail, hashedPassword, name.trim()]
    );
    
    return res.status(201).json({ message: 'Registration successful' });
    
  } catch (err) {
    console.error('Registration error occurred');
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error occurred');
  res.status(500).json({ message: 'An internal error occurred' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;