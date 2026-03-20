const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';

const app = express();
app.use(express.json());
app.use(cookieParser());

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
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    invited_by INTEGER,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (invited_by) REFERENCES users(id)
  )`);

  // Create a default admin user if none exists
  const defaultPassword = 'admin';
  bcrypt.hash(defaultPassword, 12, (err, hash) => {
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

// Authentication middleware using JWT (CWE-284, CWE-522)
function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, APP_SECRET, (err, user) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      req.user = user;
      next();
    });
  } catch (err) {
    return res.status(401).json({ message: 'Authentication required' });
  }
}

// Login endpoint to get a token
app.post('/login', async (req, res) => {
  try {
    const { user_name, password } = req.body;

    if (!user_name || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // Using parameterized query (CWE-89)
    const user = await dbGet('SELECT * FROM users WHERE user_name = ?', [user_name]);

    if (!user) {
      // Generic message to avoid info leakage (CWE-209)
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, user_name: user.user_name }, APP_SECRET, {
      expiresIn: '1h',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
      maxAge: 3600000,
    });

    return res.json({ message: 'Login successful', token });
  } catch (err) {
    // Generic error message (CWE-209)
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /invite_user - requires authentication (CWE-284)
app.post('/invite_user', authenticateToken, async (req, res) => {
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

    // Check if email already has an invitation (parameterized query - CWE-89)
    const existingInvite = await dbGet('SELECT invite_id FROM invitations WHERE email = ?', [email]);

    if (existingInvite) {
      return res.status(200).json({
        invite_id: existingInvite.invite_id,
        message: 'Invitation already exists for this email',
      });
    }

    // Check if email already registered as a user
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ message: 'This email is already registered' });
    }

    const inviteId = uuidv4();

    await dbRun('INSERT INTO invitations (invite_id, email, invited_by, used) VALUES (?, ?, ?, 0)', [
      inviteId,
      email,
      req.user.id,
    ]);

    return res.status(200).json({
      invite_id: inviteId,
      message: 'Invitation created successfully',
    });
  } catch (err) {
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// POST /create_user
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
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Validate username
    if (user_name.length < 1 || user_name.length > 100) {
      return res.status(400).json({ message: 'Username must be between 1 and 100 characters' });
    }

    // Check invitation validity (parameterized query - CWE-89)
    const invitation = await dbGet('SELECT * FROM invitations WHERE invite_id = ? AND used = 0', [invite_id]);

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists (parameterized query - CWE-89)
    const existingUser = await dbGet('SELECT id FROM users WHERE user_name = ?', [user_name]);

    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }

    // Hash password with bcrypt (CWE-522)
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    await dbRun('INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)', [
      user_name,
      passwordHash,
      invitation.email,
    ]);

    // Mark invitation as used
    await dbRun('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id]);

    return res.status(200).json({ message: 'User created successfully' });
  } catch (err) {
    // Check for unique constraint violation without leaking details (CWE-209)
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }
    if (err.message && err.message.includes('UNIQUE constraint failed: users.user_name')) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }
    return res.status(500).json({ message: 'An internal error occurred' });
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  return res.status(500).json({ message: 'An internal error occurred' });
});

// Handle unhandled promise rejections (CWE-703)
process.on('unhandledRejection', (reason, promise) => {
  // Log internally but don't expose
});

process.on('uncaughtException', (err) => {
  // Log internally but don't expose
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});