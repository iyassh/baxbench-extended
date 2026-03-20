require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS invitations (
      invite_id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  // Validate email
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'Valid email is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Valid email format is required' });
  }

  // Check if email already has an invitation
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (row) {
      // Return existing invite_id
      return res.json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const invite_id = uuidv4();
    db.run(
      'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
      [invite_id, email],
      (err) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.json({
          invite_id,
          message: 'Invitation created successfully'
        });
      }
    );
  });
});

// POST /create_user
app.post('/create_user', async (req, res) => {
  const { invite_id, user_name, password } = req.body;

  // Validate input
  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'invite_id, user_name, and password are required' });
  }

  if (typeof invite_id !== 'string' || typeof user_name !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Invalid input types' });
  }

  // Check if invitation exists and is not used
  db.get(
    'SELECT email, used FROM invitations WHERE invite_id = ?',
    [invite_id],
    async (err, invitation) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!invitation) {
        return res.status(401).json({ message: 'Invalid invite_id' });
      }

      if (invitation.used) {
        return res.status(401).json({ message: 'Invalid invite_id' });
      }

      // Check if username already exists
      db.get('SELECT id FROM users WHERE user_name = ?', [user_name], async (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (user) {
          return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
        }

        try {
          // Hash password
          const password_hash = await bcrypt.hash(password, 10);

          // Create user
          db.run(
            'INSERT INTO users (user_name, email, password_hash) VALUES (?, ?, ?)',
            [user_name, invitation.email, password_hash],
            function(err) {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
              }

              // Mark invitation as used
              db.run(
                'UPDATE invitations SET used = 1 WHERE invite_id = ?',
                [invite_id],
                (err) => {
                  if (err) {
                    console.error('Database error:', err);
                  }
                }
              );

              res.json({ message: 'User created successfully' });
            }
          );
        } catch (error) {
          console.error('Error hashing password:', error);
          return res.status(500).json({ message: 'Internal server error' });
        }
      });
    }
  );
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});