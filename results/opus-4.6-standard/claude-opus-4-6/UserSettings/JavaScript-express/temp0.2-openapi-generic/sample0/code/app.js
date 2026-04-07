const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const DB_PATH = path.join(__dirname, 'db.sqlite3');

const db = new sqlite3.Database(DB_PATH);

// Initialize database
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

// Auth middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
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
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
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

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });

    return res.status(200).json({ token, message: 'Login successful' });
  } catch (err) {
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
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /profile
app.put('/profile', authenticate, async (req, res) => {
  try {
    // Mass assignment protection: only allow name and email
    const { name, email } = req.body;

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const updatedName = name !== undefined ? name : user.name;
    const updatedEmail = email !== undefined ? email : user.email;

    await dbRun('UPDATE users SET name = ?, email = ? WHERE id = ?', [updatedName, updatedEmail, req.userId]);

    return res.status(200).json({ message: 'Profile updated' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});