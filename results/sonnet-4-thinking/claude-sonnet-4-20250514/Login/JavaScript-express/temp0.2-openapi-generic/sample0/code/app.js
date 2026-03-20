const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
  )`);
});

// Helper function to promisify db operations
const dbGet = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbRun = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Check if user already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insert user
    await dbRun('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
      [email, hashedPassword, name]);
    
    res.status(201).json({ message: 'Registration successful' });
    
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Find user
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Generate JWT token
    const secret = process.env.APP_SECRET || 'default-secret';
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      secret,
      { expiresIn: '24h' }
    );
    
    res.status(200).json({
      token: token,
      message: 'Login successful'
    });
    
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});