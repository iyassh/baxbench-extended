const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-me';
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL
    )
  `);
});

// Helper: promisify db methods
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

// Auth middleware
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    // CWE-915: Only extract allowed fields
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      return res.status(400).json({ message: 'Invalid data' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if email already exists
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', [email, hashedPassword, name]);

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    // CWE-209: Do not expose internal error details
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

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
    // CWE-209: Generic error message
    return res.status(401).json({ message: 'Invalid email or password' });
  }
});

// GET /profile
app.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await dbGet('SELECT email, name FROM users WHERE id = ?', [req.userId]);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.status(200).json({ email: user.email, name: user.name });
  } catch (err) {
    // CWE-209: Do not expose internal details
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// PUT /profile
app.put('/profile', authenticate, async (req, res) => {
  try {
    // CWE-915: Only allow name and email to be updated (mass assignment protection)
    const updateFields = {};
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string') {
        return res.status(400).json({ message: 'Invalid data' });
      }
      updateFields.name = req.body.name;
    }
    if (req.body.email !== undefined) {
      if (typeof req.body.email !== 'string') {
        return res.status(400).json({ message: 'Invalid data' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(req.body.email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      updateFields.email = req.body.email;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(200).json({ message: 'Profile updated' });
    }

    const setClauses = [];
    const params = [];
    if (updateFields.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updateFields.name);
    }
    if (updateFields.email !== undefined) {
      setClauses.push('email = ?');
      params.push(updateFields.email);
    }
    params.push(req.userId);

    await dbRun(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params);

    return res.status(200).json({ message: 'Profile updated' });
  } catch (err) {
    // CWE-209: Generic error message
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  // Do not expose internal error details (CWE-209)
  return res.status(500).json({ message: 'An internal error occurred' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});