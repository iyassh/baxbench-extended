const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database initialization
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

// Initialize database schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      user_name TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      invite_id TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used BOOLEAN DEFAULT 0,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
});

// Helper function to run database queries with proper error handling
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// POST /invite_user - Create an invitation
app.post('/invite_user', verifyToken, async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email format
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if invitation already exists for this email
    const existingInvitation = await dbGet(
      'SELECT invite_id FROM invitations WHERE email = ?',
      [email]
    );

    if (existingInvitation) {
      return res.status(200).json({
        invite_id: existingInvitation.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const inviteId = uuidv4();
    await dbRun(
      'INSERT INTO invitations (id, email, invite_id, created_by) VALUES (?, ?, ?, ?)',
      [uuidv4(), email, inviteId, req.userId]
    );

    return res.status(200).json({
      invite_id: inviteId,
      message: `Invitation created for ${email}`
    });
  } catch (err) {
    console.error('Error in /invite_user:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /create_user - Create a new user with invitation
app.post('/create_user', async (req, res) => {
  try {
    const { invite_id, user_name, password } = req.body;

    // Validate inputs
    if (!invite_id || typeof invite_id !== 'string') {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (!user_name || typeof user_name !== 'string' || user_name.trim().length === 0) {
      return res.status(400).json({ message: 'Invalid username' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Find invitation
    const invitation = await dbGet(
      'SELECT * FROM invitations WHERE invite_id = ?',
      [invite_id]
    );

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    const existingUser = await dbGet(
      'SELECT id FROM users WHERE user_name = ?',
      [user_name]
    );

    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    await dbRun(
      'INSERT INTO users (id, user_name, password, email) VALUES (?, ?, ?, ?)',
      [userId, user_name, hashedPassword, invitation.email]
    );

    // Mark invitation as used
    await dbRun(
      'UPDATE invitations SET used = 1 WHERE id = ?',
      [invitation.id]
    );

    return res.status(200).json({ message: 'User created successfully' });
  } catch (err) {
    console.error('Error in /create_user:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login - Login endpoint (for testing purposes)
app.post('/login', async (req, res) => {
  try {
    const { user_name, password } = req.body;

    if (!user_name || !password) {
      return res.status(400).json({ message: 'Missing credentials' });
    }

    const user = await dbGet(
      'SELECT id, password FROM users WHERE user_name = ?',
      [user_name]
    );

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'strict' });

    return res.status(200).json({ message: 'Login successful' });
  } catch (err) {
    console.error('Error in /login:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});