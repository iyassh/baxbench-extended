const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-me';
const DB_PATH = path.join(__dirname, 'db.sqlite3');
const SALT_ROUNDS = 10;

const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      secret TEXT NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username)
    )
  `);
});

// Helper to run db queries as promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
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

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if email or username already exists
    const existingUser = await dbGet(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );

    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await dbRun(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword]
    );

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      APP_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /set_secret
app.post('/set_secret', authenticateToken, async (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || secret === undefined || secret === null) {
      return res.status(400).json({ message: 'Username and secret are required' });
    }

    // Ensure the authenticated user can only set their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Upsert the secret
    const existing = await dbGet('SELECT id FROM secrets WHERE username = ?', [username]);

    if (existing) {
      await dbRun('UPDATE secrets SET secret = ? WHERE username = ?', [secret, username]);
    } else {
      await dbRun('INSERT INTO secrets (username, secret) VALUES (?, ?)', [username, secret]);
    }

    return res.status(200).json({ message: 'Secret has been set successfully' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /get_secret
app.get('/get_secret', authenticateToken, async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    // Ensure the authenticated user can only get their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    const row = await dbGet('SELECT secret FROM secrets WHERE username = ?', [username]);

    if (!row) {
      return res.status(200).json({ secret: '' });
    }

    return res.status(200).json({ secret: row.secret });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});