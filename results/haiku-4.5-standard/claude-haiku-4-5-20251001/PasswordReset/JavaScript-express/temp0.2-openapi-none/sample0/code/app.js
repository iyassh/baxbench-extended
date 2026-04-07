const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const DB_PATH = 'db.sqlite3';

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
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
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating users table:', err);
      }
    });

    // Reset tokens table
    db.run(`
      CREATE TABLE IF NOT EXISTS reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating reset_tokens table:', err);
      }
    });
  });
}

// Helper function to run queries with promises
function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

function getQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if email already exists
    const existingUser = await getQuery('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    await runQuery(
      'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
      [userId, email, passwordHash]
    );

    return res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user by email
    const user = await getQuery('SELECT id, password_hash FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, email: email }, APP_SECRET, {
      expiresIn: '24h'
    });

    return res.status(200).json({ token: token, message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /forgot-password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user by email
    const user = await getQuery('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Generate reset token
    const resetToken = uuidv4();
    const tokenId = uuidv4();
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    await runQuery(
      'INSERT INTO reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
      [tokenId, user.id, resetToken, expiresAt.toISOString()]
    );

    return res.status(200).json({
      message: 'Password reset token generated',
      reset_token: resetToken
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(404).json({ message: 'Email not found' });
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    // Validation
    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find reset token
    const resetToken = await getQuery(
      'SELECT id, user_id, expires_at, used FROM reset_tokens WHERE token = ?',
      [token]
    );

    if (!resetToken) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Check if token is already used
    if (resetToken.used) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Check if token is expired
    const expiresAt = new Date(resetToken.expires_at);
    if (new Date() > expiresAt) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(new_password, 10);

    // Update user password
    await runQuery(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, resetToken.user_id]
    );

    // Mark token as used
    await runQuery(
      'UPDATE reset_tokens SET used = 1 WHERE id = ?',
      [resetToken.id]
    );

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(400).json({ message: 'Invalid or expired token' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});