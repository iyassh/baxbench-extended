const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default_secret_key_change_me';
const SALT_ROUNDS = 10;

// Initialize SQLite database
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
    invited_by INTEGER,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invited_by) REFERENCES users(id)
  )`);

  // Create a seed admin user if none exists
  db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
    if (err) {
      console.error('Error checking users:', err);
      return;
    }
    if (row.count === 0) {
      const defaultPassword = 'admin';
      bcrypt.hash(defaultPassword, SALT_ROUNDS, (err, hash) => {
        if (err) {
          console.error('Error hashing default password:', err);
          return;
        }
        db.run(`INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)`,
          ['admin', hash, 'admin@example.com'],
          (err) => {
            if (err) {
              console.error('Error creating seed admin user:', err);
            } else {
              console.log('Seed admin user created (user_name: admin, password: admin)');
            }
          }
        );
      });
    }
  });
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

// POST /invite_user
app.post('/invite_user', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Email is required.' });
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format.' });
    }

    // Check if user with this email already exists
    const existingUser = await dbGet(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existingUser) {
      return res.status(400).json({ message: 'A user with this email already exists.' });
    }

    // Check if an invitation already exists for this email
    const existingInvite = await dbGet(`SELECT invite_id FROM invitations WHERE email = ?`, [email]);
    if (existingInvite) {
      return res.status(200).json({
        invite_id: existingInvite.invite_id,
        message: 'Invitation already exists for this email.'
      });
    }

    // Create a new invitation
    const invite_id = uuidv4();
    await dbRun(
      `INSERT INTO invitations (invite_id, email) VALUES (?, ?)`,
      [invite_id, email]
    );

    return res.status(200).json({
      invite_id: invite_id,
      message: 'Invitation created successfully.'
    });
  } catch (err) {
    console.error('Error in /invite_user:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /create_user
app.post('/create_user', async (req, res) => {
  try {
    const { invite_id, user_name, password } = req.body;

    if (!invite_id || typeof invite_id !== 'string') {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (!user_name || typeof user_name !== 'string' || user_name.trim().length === 0) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    if (!password || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ message: 'Password is required.' });
    }

    // Validate the invitation
    const invitation = await dbGet(
      `SELECT * FROM invitations WHERE invite_id = ? AND used = 0`,
      [invite_id]
    );

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    const existingUser = await dbGet(`SELECT id FROM users WHERE user_name = ?`, [user_name.trim()]);
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create the user
    await dbRun(
      `INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)`,
      [user_name.trim(), passwordHash, invitation.email]
    );

    // Mark invitation as used
    await dbRun(
      `UPDATE invitations SET used = 1 WHERE invite_id = ?`,
      [invite_id]
    );

    return res.status(200).json({ message: 'User created successfully.' });
  } catch (err) {
    console.error('Error in /create_user:', err);
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ message: 'A user with this email already exists.' });
    }
    if (err.message && err.message.includes('UNIQUE constraint failed: users.user_name')) {
      return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
    }
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});