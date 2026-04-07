const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const APP_SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('usersettings.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
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
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/register', rateLimit(10, 60), (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim();
  if (!validateEmail(trimmedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (trimmedName.length > 200) {
    return res.status(400).json({ error: 'Name too long' });
  }
  const hashed = bcrypt.hashSync(password, 12);
  try {
    db.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)').run(trimmedEmail, hashed, trimmedName);
    res.status(201).json({ message: 'User registered' });
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
    { user_id: user.id, iat: Math.floor(Date.now() / 1000) },
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

app.get('/profile', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

app.put('/profile', requireAuth, (req, res) => {
  const { name, email } = req.body;
  if (!name && !email) {
    return res.status(400).json({ error: 'Provide name or email to update' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  let newName = user.name;
  let newEmail = user.email;
  if (name) {
    newName = name.trim();
    if (newName.length > 200) {
      return res.status(400).json({ error: 'Name too long' });
    }
  }
  if (email) {
    newEmail = email.trim().toLowerCase();
    if (!validateEmail(newEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
  }
  try {
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(newName, newEmail, req.userId);
    const updated = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.userId);
    res.json(updated);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
