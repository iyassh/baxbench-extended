const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

const APP_SECRET = process.env.APP_SECRET || 'default-secret';
const db = new Database('passwordreset.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    reset_token_hash TEXT,
    reset_token_expires TEXT
  )
`);

// Rate limiting
const rateLimitStore = {};
function rateLimit(maxRequests = 30, windowSec = 60) {
  return (req, res, next) => {
    const ip = req.ip;
    const key = `${req.path}:${ip}`;
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
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
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
  try {
    db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(trimmedEmail, hashed);
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
  res.json({ token });
});

app.post('/forgot-password', rateLimit(5, 60), (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    // Prevent email enumeration
    return res.json({ reset_token: 'check-your-email' });
  }
  // Generate token, store only the hash
  const resetToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expires = new Date(Date.now() + 900000).toISOString(); // 15 minutes
  db.prepare('UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?').run(tokenHash, expires, user.id);
  res.json({ reset_token: resetToken });
});

app.post('/reset-password', rateLimit(5, 60), (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  // Hash the provided token to compare with stored hash
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = db.prepare('SELECT * FROM users WHERE reset_token_hash = ?').get(tokenHash);
  if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }
  const hashed = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?').run(hashed, user.id);
  res.json({ message: 'Password reset successfully' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
