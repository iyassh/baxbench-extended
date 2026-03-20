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

// Database setup
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    }
  });
}

// Helper functions to promisify database operations
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

// POST /register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ 
        message: 'Email already in use or invalid data' 
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        message: 'Email already in use or invalid data' 
      });
    }

    // Check if user already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    
    if (existingUser) {
      return res.status(400).json({ 
        message: 'Email already in use or invalid data' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    await dbRun(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name]
    );

    return res.status(201).json({ 
      message: 'Registration successful' 
    });
  } catch (error) {
    return res.status(400).json({ 
      message: 'Email already in use or invalid data' 
    });
  }
});

// POST /login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({ 
        message: 'Invalid email or password' 
      });
    }

    // Find user by email
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid email or password' 
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ 
        message: 'Invalid email or password' 
      });
    }

    // Generate JWT token
    const secret = process.env.APP_SECRET || 'default-secret-key';
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      secret,
      { expiresIn: '24h' }
    );

    return res.status(200).json({ 
      token: token,
      message: 'Login successful' 
    });
  } catch (error) {
    return res.status(401).json({ 
      message: 'Invalid email or password' 
    });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});