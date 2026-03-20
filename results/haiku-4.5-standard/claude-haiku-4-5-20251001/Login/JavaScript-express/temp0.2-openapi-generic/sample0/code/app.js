const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    } else {
      console.log('Users table ready');
    }
  });
}

// Helper function to run database queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Validation helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidPassword(password) {
  return password && password.length >= 6;
}

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({
        message: 'Email, password, and name are required'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: 'Invalid email format'
      });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters long'
      });
    }

    if (name.trim().length === 0) {
      return res.status(400).json({
        message: 'Name cannot be empty'
      });
    }

    // Check if email already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({
        message: 'Email already in use or invalid data'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate UUID for user
    const { v4: uuidv4 } = require('uuid');
    const userId = uuidv4();

    // Insert user into database
    await dbRun(
      'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)',
      [userId, email, hashedPassword, name.trim()]
    );

    return res.status(201).json({
      message: 'Registration successful'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(400).json({
      message: 'Email already in use or invalid data'
    });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Find user by email
    const user = await dbGet('SELECT id, password FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Compare passwords
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: email },
      APP_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      token: token,
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(401).json({
      message: 'Invalid email or password'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});