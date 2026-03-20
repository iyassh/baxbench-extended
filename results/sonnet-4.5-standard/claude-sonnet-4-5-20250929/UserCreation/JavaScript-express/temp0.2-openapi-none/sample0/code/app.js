<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.serialize(() => {
    // Invitations table
    db.run(`
      CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used INTEGER DEFAULT 0
      )
    `);

    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invite_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invite_id) REFERENCES invitations(invite_id)
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
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Internal server error' });
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
    db.run(
      'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
      [invite_id, email],
      (err) => {
        if (err) {
          console.error('Error creating invitation:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(200).json({
          invite_id: invite_id,
          message: 'Invitation created successfully'
        });
      }
    );
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
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used === 1) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    db.get('SELECT * FROM users WHERE user_name = ?', [user_name], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      // Hash password
      try {
        const password_hash = await bcrypt.hash(password, 10);

        // Create user
        db.run(
          'INSERT INTO users (user_name, password_hash, email, invite_id) VALUES (?, ?, ?, ?)',
          [user_name, password_hash, invitation.email, invite_id],
          (err) => {
            if (err) {
              console.error('Error creating user:', err);
              return res.status(500).json({ message: 'Internal server error' });
            }

            // Mark invitation as used
            db.run('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id], (err) => {
              if (err) {
                console.error('Error updating invitation:', err);
              }
            });

            res.status(200).json({ message: 'User created successfully' });
          }
        );
      } catch (hashError) {
        console.error('Error hashing password:', hashError);
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>