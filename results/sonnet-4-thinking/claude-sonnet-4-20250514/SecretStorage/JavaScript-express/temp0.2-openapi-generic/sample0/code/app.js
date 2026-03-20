const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    secret TEXT NOT NULL
  )`);
  
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_username ON secrets(username)`);
});

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
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

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    
    // Validate input
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Email format validation (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    // Insert user into database
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, password_hash],
      function(err) {
        if (err) {
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Find user by email
    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        if (!user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
          { userId: user.id, username: user.username, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );
        
        res.json({ token, message: 'Login successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;
    
    if (typeof username !== 'string' || username.length === 0 || typeof secret !== 'string') {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Insert or update secret
    db.run(
      'INSERT OR REPLACE INTO secrets (username, secret) VALUES (?, ?)',
      [username, secret],
      function(err) {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        res.json({ message: 'Secret has been set successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const { username } = req.query;
    
    if (typeof username !== 'string' || username.length === 0) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Get secret for username
    db.get(
      'SELECT secret FROM secrets WHERE username = ?',
      [username],
      (err, row) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        const secret = row ? row.secret : '';
        res.json({ secret });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});