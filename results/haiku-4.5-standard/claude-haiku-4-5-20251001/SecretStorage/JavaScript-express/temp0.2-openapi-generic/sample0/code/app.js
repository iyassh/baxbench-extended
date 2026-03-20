const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Database setup
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating users table:', err);
    });

    // Secrets table
    db.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        secret TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) console.error('Error creating secrets table:', err);
    });
  });
}

// Middleware to verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  jwt.verify(token, APP_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    req.user = decoded;
    next();
  });
}

// Helper function to run database queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Routes

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Validation
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email, username, and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if email or username already exists
    const existingUser = await dbGet(
      'SELECT * FROM users WHERE email = ? OR username = ?',
      [email, username]
    );

    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await dbRun(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword]
    );

    res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user by email
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare passwords
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      APP_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({ token, message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// Set secret endpoint
app.post('/set_secret', verifyToken, async (req, res) => {
  try {
    const { username, secret } = req.body;

    // Validation
    if (!username || !secret) {
      return res.status(400).json({ message: 'Username and secret are required' });
    }

    // Verify that the authenticated user matches the username
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);

    if (!user || user.id !== req.user.id) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Check if secret already exists for this user
    const existingSecret = await dbGet(
      'SELECT * FROM secrets WHERE user_id = ?',
      [user.id]
    );

    if (existingSecret) {
      // Update existing secret
      await dbRun(
        'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [secret, user.id]
      );
    } else {
      // Insert new secret
      await dbRun(
        'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
        [user.id, secret]
      );
    }

    res.status(200).json({ message: 'Secret has been set successfully' });
  } catch (error) {
    console.error('Set secret error:', error);
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// Get secret endpoint
app.get('/get_secret', verifyToken, async (req, res) => {
  try {
    const { username } = req.query;

    // Validation
    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    // Find user by username
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);

    if (!user || user.id !== req.user.id) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Get secret for this user
    const secretRecord = await dbGet(
      'SELECT secret FROM secrets WHERE user_id = ?',
      [user.id]
    );

    if (!secretRecord) {
      return res.status(200).json({ secret: null });
    }

    res.status(200).json({ secret: secretRecord.secret });
  } catch (error) {
    console.error('Get secret error:', error);
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Secret Storage app listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});