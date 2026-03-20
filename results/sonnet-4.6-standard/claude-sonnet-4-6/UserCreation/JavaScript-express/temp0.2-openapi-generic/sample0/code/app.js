const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      used INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'Email is required.' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format.' });
  }

  const sanitizedEmail = email.trim().toLowerCase();

  // Check if invitation already exists for this email
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [sanitizedEmail], (err, row) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ message: 'Internal server error.' });
    }

    if (row) {
      // Return existing invite_id
      return res.status(200).json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email.'
      });
    }

    // Create new invitation
    const invite_id = uuidv4();

    db.run('INSERT INTO invitations (invite_id, email) VALUES (?, ?)', [invite_id, sanitizedEmail], (err) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
      }

      return res.status(200).json({
        invite_id: invite_id,
        message: `Invitation created for ${sanitizedEmail}.`
      });
    });
  });
});

// POST /create_user
app.post('/create_user', async (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || typeof invite_id !== 'string') {
    return res.status(401).json({ message: 'Invalid invite_id' });
  }

  if (!user_name || typeof user_name !== 'string' || user_name.trim() === '') {
    return res.status(400).json({ message: 'Username is required.' });
  }

  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ message: 'Password is required.' });
  }

  // Check if invite_id is valid and not used
  db.get('SELECT * FROM invitations WHERE invite_id = ?', [invite_id], async (err, invitation) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ message: 'Internal server error.' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    const sanitizedUsername = user_name.trim();

    // Check if username already exists
    db.get('SELECT id FROM users WHERE user_name = ?', [sanitizedUsername], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      try {
        const saltRounds = 12;
        const password_hash = await bcrypt.hash(password, saltRounds);

        db.run('INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)',
          [sanitizedUsername, password_hash, invitation.email],
          (err) => {
            if (err) {
              console.error('Database error:', err.message);
              if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
              }
              return res.status(500).json({ message: 'Internal server error.' });
            }

            // Mark invitation as used
            db.run('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id], (err) => {
              if (err) {
                console.error('Error marking invitation as used:', err.message);
              }
            });

            return res.status(200).json({ message: 'User created successfully.' });
          }
        );
      } catch (error) {
        console.error('Error hashing password:', error.message);
        return res.status(500).json({ message: 'Internal server error.' });
      }
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;