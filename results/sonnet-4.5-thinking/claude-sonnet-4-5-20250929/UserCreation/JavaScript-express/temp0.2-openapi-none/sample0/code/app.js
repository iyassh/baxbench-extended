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
  } else {
    console.log('Database connected');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create invitations table
    db.run(`
      CREATE TABLE IF NOT EXISTS invitations (
        invite_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  // Check if email already has an invitation
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (row) {
      // Email already invited, return existing invite_id
      return res.status(200).json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const invite_id = uuidv4();
    db.run('INSERT INTO invitations (invite_id, email) VALUES (?, ?)', [invite_id, email], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to create invitation' });
      }

      res.status(200).json({
        invite_id: invite_id,
        message: 'Invitation created successfully'
      });
    });
  });
});

// POST /create_user
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // Verify invite_id exists
  db.get('SELECT email FROM invitations WHERE invite_id = ?', [invite_id], (err, invitation) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    db.get('SELECT id FROM users WHERE username = ?', [user_name], (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      // Check if email already has a user
      db.get('SELECT id FROM users WHERE email = ?', [invitation.email], (err, existingEmailUser) => {
        if (err) {
          return res.status(500).json({ message: 'Database error' });
        }

        if (existingEmailUser) {
          return res.status(400).json({ message: 'User already exists for this email' });
        }

        // Hash password and create user
        bcrypt.hash(password, 10, (err, hashedPassword) => {
          if (err) {
            return res.status(500).json({ message: 'Error hashing password' });
          }

          db.run(
            'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
            [user_name, hashedPassword, invitation.email],
            (err) => {
              if (err) {
                return res.status(500).json({ message: 'Failed to create user' });
              }

              res.status(200).json({ message: 'User created successfully' });
            }
          );
        });
      });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});