const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';
const SALT_ROUNDS = 12;

app.use(express.json());
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    invited_by INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invited_by) REFERENCES users(id)
  )`);

  // Create a seed/admin user so the system can bootstrap
  // The first user is created with a known credential
  bcrypt.hash('admin_password', SALT_ROUNDS, (err, hash) => {
    if (err) return;
    db.run(
      `INSERT OR IGNORE INTO users (user_name, password_hash, email) VALUES (?, ?, ?)`,
      ['admin', hash, 'admin@example.com'],
      (err) => {
        if (err) {
          // Ignore duplicate errors
        }
      }
    );
  });
});

// Helper to run db queries as promises
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Authentication middleware - checks for JWT in Authorization header or cookie
function authenticate(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Login endpoint to get a token
app.post('/login', async (req, res) => {
  try {
    const { user_name, password } = req.body;

    if (!user_name || !password) {
      return res.status(400).json({ message: 'user_name and password are required' });
    }

    const user = await dbGet('SELECT * FROM users WHERE user_name = ?', [user_name]);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, user_name: user.user_name }, APP_SECRET, {
      expiresIn: '24h',
    });

    res.json({ token, message: 'Login successful' });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /invite_user - requires authentication
app.post('/invite_user', authenticate, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'A valid email is required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if email is already registered as a user
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ message: 'Email is already registered' });
    }

    // Check if an invitation already exists for this email
    const existingInvite = await dbGet('SELECT invite_id FROM invitations WHERE email = ?', [email]);
    if (existingInvite) {
      return res.status(200).json({
        invite_id: existingInvite.invite_id,
        message: 'Invitation already exists for this email',
      });
    }

    // Create new invitation
    const invite_id = uuidv4();
    await dbRun('INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)', [
      invite_id,
      email,
      req.user.userId,
    ]);

    return res.status(200).json({
      invite_id,
      message: 'Invitation created successfully',
    });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /create_user - public but requires valid invite_id
app.post('/create_user', async (req, res) => {
  try {
    const { invite_id, user_name, password } = req.body;

    if (!invite_id || !user_name || !password) {
      return res.status(400).json({ message: 'invite_id, user_name, and password are required' });
    }

    if (typeof invite_id !== 'string' || typeof user_name !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid input types' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    // Validate username
    if (user_name.length < 3 || user_name.length > 50) {
      return res.status(400).json({ message: 'Username must be between 3 and 50 characters' });
    }

    // Check invitation validity
    const invitation = await dbGet(
      'SELECT * FROM invitations WHERE invite_id = ? AND used = 0',
      [invite_id]
    );

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE user_name = ?', [user_name]);
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }

    // Hash password securely (CWE-522 mitigation)
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    await dbRun('INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)', [
      user_name,
      password_hash,
      invitation.email,
    ]);

    // Mark invitation as used
    await dbRun('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id]);

    return res.status(200).json({ message: 'User created successfully' });
  } catch (err) {
    // Check for unique constraint violation on email
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    if (err.message && err.message.includes('UNIQUE constraint failed: users.user_name')) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  // Don't leak error details (CWE-209)
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});