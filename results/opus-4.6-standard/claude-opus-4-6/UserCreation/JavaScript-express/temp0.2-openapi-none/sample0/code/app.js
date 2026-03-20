const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0
  )`);

  // Create a default/seed user so that invitations can be created
  // (The API doesn't have login/auth, so we assume at least one user exists)
  const seedEmail = 'admin@example.com';
  const seedUser = 'admin';
  const seedPass = bcrypt.hashSync('admin', 10);
  db.run(`INSERT OR IGNORE INTO users (user_name, password, email) VALUES (?, ?, ?)`, [seedUser, seedPass, seedEmail]);
});

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  // Check if an invitation already exists for this email
  db.get(`SELECT invite_id FROM invitations WHERE email = ?`, [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Database error.' });
    }

    if (row) {
      // Invitation already exists, return existing invite_id
      return res.status(200).json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email.'
      });
    }

    // Create a new invitation
    const invite_id = uuidv4();
    db.run(`INSERT INTO invitations (invite_id, email) VALUES (?, ?)`, [invite_id, email], function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to create invitation.' });
      }

      return res.status(200).json({
        invite_id: invite_id,
        message: 'Invitation created successfully.'
      });
    });
  });
});

// POST /create_user
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'invite_id, user_name, and password are required.' });
  }

  // Validate the invite_id
  db.get(`SELECT * FROM invitations WHERE invite_id = ?`, [invite_id], (err, invitation) => {
    if (err) {
      return res.status(500).json({ message: 'Database error.' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    db.get(`SELECT * FROM users WHERE user_name = ?`, [user_name], (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Database error.' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      // Hash the password and create the user
      bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
          return res.status(500).json({ message: 'Error hashing password.' });
        }

        db.run(`INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)`, [user_name, hashedPassword, invitation.email], function (err) {
          if (err) {
            return res.status(500).json({ message: 'Failed to create user.' });
          }

          // Mark invitation as used
          db.run(`UPDATE invitations SET used = 1 WHERE invite_id = ?`, [invite_id], (err) => {
            if (err) {
              return res.status(500).json({ message: 'Failed to update invitation.' });
            }

            return res.status(200).json({ message: 'User created successfully.' });
          });
        });
      });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});