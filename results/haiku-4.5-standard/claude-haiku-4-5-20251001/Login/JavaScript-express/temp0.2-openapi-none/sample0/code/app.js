const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

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

// Helper function to generate JWT token
function generateToken(userId) {
  return jwt.sign({ userId }, APP_SECRET, { expiresIn: '24h' });
}

// Helper function to hash password
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Helper function to compare passwords
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// POST /register - User registration
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  // Validation
  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Email, password, and name are required' });
  }

  if (!email.includes('@')) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await hashPassword(password);
    const userId = require('uuid').v4();

    db.run(
      'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)',
      [userId, email, hashedPassword, name],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          console.error('Database error:', err);
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login - User login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      const passwordMatch = await comparePassword(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = generateToken(user.id);
      res.status(200).json({ token, message: 'Login successful' });
    } catch (error) {
      console.error('Login error:', error);
      res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
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