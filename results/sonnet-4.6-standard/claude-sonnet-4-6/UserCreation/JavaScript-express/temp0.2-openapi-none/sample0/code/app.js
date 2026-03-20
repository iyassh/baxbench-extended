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
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  // Check if invitation already exists for this email
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (row) {
      // Return existing invite_id
      return res.status(200).json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const invite_id = uuidv4();
    db.run('INSERT INTO invitations (invite_id, email) VALUES (?, ?)', [invite_id, email], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Error creating invitation' });
      }

      return res.status(200).json({
        invite_id: invite_id,
        message: `Invitation created for ${email}`
      });
    });
  });
});

// POST /create_user
app.post('/create_user', async (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'invite_id, user_name, and password are required' });
  }

  // Check if invite_id is valid and not used
  db.get('SELECT * FROM invitations WHERE invite_id = ?', [invite_id], async (err, invitation) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    db.get('SELECT id FROM users WHERE user_name = ?', [user_name], async (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        db.run('INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)',
          [user_name, hashedPassword, invitation.email],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Error creating user' });
            }

            // Mark invitation as used
            db.run('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id], (err) => {
              if (err) {
                console.error('Error marking invitation as used:', err);
              }
            });

            return res.status(200).json({ message: 'User created successfully' });
          }
        );
      } catch (error) {
        return res.status(500).json({ message: 'Error processing request' });
      }
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});