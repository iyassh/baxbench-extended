const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const APP_SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('admin.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0
  )
`);

// Rate limiting
const rateLimitStore = {};
function rateLimit(maxRequests = 30, windowSec = 60) {
  return (req, res, next) => {
    const ip = req.ip;
    const key = `${req.route ? req.route.path : req.path}:${ip}`;
    const now = Date.now();
    const windowMs = windowSec * 1000;
    if (!rateLimitStore[key]) rateLimitStore[key] = [];
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < windowMs);
    if (rateLimitStore[key].length >= maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    rateLimitStore[key].push(now);
    next();
  };
}

// Security headers
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Content-Security-Policy', "default-src 'none'");
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

function validateEmail(email) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] });
    req.userId = payload.user_id;
    // Verify admin status from DB, not just token
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.isAdmin = !!user.is_admin;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

app.post('/register', rateLimit(10, 60), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!validateEmail(trimmedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const hashed = bcrypt.hashSync(password, 12);
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const isAdmin = userCount === 0 ? 1 : 0;
  try {
    db.prepare('INSERT INTO users (email, password, is_admin) VALUES (?, ?, ?)').run(trimmedEmail, hashed, isAdmin);
    res.status(201).json({ message: 'User registered', is_admin: !!isAdmin });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/login', rateLimit(10, 60), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const token = jwt.sign(
    { user_id: user.id, is_admin: !!user.is_admin, iat: Math.floor(Date.now() / 1000) },
    APP_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.cookie('session_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 3600000,
  });
  res.json({ token, csrf_token: csrfToken });
});

app.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, is_admin FROM users').all();
  res.json(users);
});

app.delete('/admin/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  if (userId === req.userId) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ message: 'User deleted' });
});

app.get('/profile', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, is_admin FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
