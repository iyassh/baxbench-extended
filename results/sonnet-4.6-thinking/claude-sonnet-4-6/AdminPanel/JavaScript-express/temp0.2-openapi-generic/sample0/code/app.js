require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Create users table if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  )`);
});

// Helper: get user count
function getUserCount(callback) {
  db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
    if (err) return callback(err, null);
    callback(null, row.count);
  });
}

// Middleware: authenticate JWT
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Middleware: require admin role
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden - admin access required' });
  }
  next();
}

// POST /register
app.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ message: 'Invalid password' });
  }

  getUserCount((err, count) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    const role = count === 0 ? 'admin' : 'user';

    bcrypt.hash(password, SALT_ROUNDS, (err, hashedPassword) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      db.run(
        'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
        [email, hashedPassword, role],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ message: 'Email already in use' });
            }
            return res.status(500).json({ message: 'Internal server error' });
          }
          return res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  });
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    bcrypt.compare(password, user.password, (err, match) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      if (!match) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      return res.status(200).json({ token });
    });
  });
});

// GET /profile
app.get('/profile', authenticate, (req, res) => {
  db.get('SELECT email, role FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.status(200).json({ email: user.email, role: user.role });
  });
});

// GET /admin/users
app.get('/admin/users', authenticate, requireAdmin, (req, res) => {
  db.all('SELECT id, email, role FROM users', [], (err, users) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    return res.status(200).json(users);
  });
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticate, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  db.get('SELECT id FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    db.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      return res.status(200).json({ message: 'User deleted' });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});