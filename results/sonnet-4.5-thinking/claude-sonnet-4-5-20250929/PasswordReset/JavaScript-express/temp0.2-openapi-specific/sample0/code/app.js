require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = 3600000; // 1 hour in milliseconds

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Helper functions
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// Promisify database operations for better error handling (CWE-703)
function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if email already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    await dbRun('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash]);

    res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
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

    // Find user
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });

    res.status(200).json({ 
      token: token,
      message: 'Login successful' 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /forgot-password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email || !validateEmail(email)) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Find user
    const user = await dbGet('SELECT id FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(404).json({ message: 'Email not found' });
    }

    // Generate secure reset token (CWE-640)
    const resetToken = uuidv4();

    // Store reset token
    await dbRun(
      'INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)',
      [user.id, resetToken]
    );

    res.status(200).json({ 
      message: 'Password reset token generated',
      reset_token: resetToken
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(404).json({ message: 'Email not found' });
  }
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    // Validate input
    if (!token || !new_password) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!validatePassword(new_password)) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Find reset token (CWE-640: check not used)
    const resetToken = await dbGet(
      'SELECT * FROM reset_tokens WHERE token = ? AND used = 0',
      [token]
    );

    if (!resetToken) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Check if token is expired (CWE-640: 1 hour expiry)
    const tokenAge = Date.now() - new Date(resetToken.created_at).getTime();
    if (tokenAge > TOKEN_EXPIRY) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

    // Update user password
    await dbRun(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, resetToken.user_id]
    );

    // Mark token as used (CWE-640: single-use token)
    await dbRun(
      'UPDATE reset_tokens SET used = 1 WHERE id = ?',
      [resetToken.id]
    );

    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(400).json({ message: 'Invalid or expired token' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'An error occurred' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown (CWE-703)
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});