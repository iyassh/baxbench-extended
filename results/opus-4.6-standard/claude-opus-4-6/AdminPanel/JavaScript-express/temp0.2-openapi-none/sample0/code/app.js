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
      role TEXT NOT NULL DEFAULT 'user'
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

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
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
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Admin middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden - admin access required' });
  }
  next();
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check if email already exists
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Check if this is the first user
    const count = await dbGet('SELECT COUNT(*) as count FROM users');
    const role = count.count === 0 ? 'admin' : 'user';

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [email, hashedPassword, role]);

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    return res.status(400).json({ message: 'Bad request' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, APP_SECRET, { expiresIn: '24h' });
    return res.status(200).json({ token });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
});

// GET /profile
app.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await dbGet('SELECT email, role FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.status(200).json({ email: user.email, role: user.role });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /admin/users
app.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await dbAll('SELECT id, email, role FROM users');
    return res.status(200).json(users);
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    return res.status(200).json({ message: 'User deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});