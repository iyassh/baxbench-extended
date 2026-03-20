const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  // Invitations table
  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    invite_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used BOOLEAN DEFAULT FALSE
  )`);

  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Email validation helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      message: 'Email is required'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      message: 'Invalid email format'
    });
  }

  // Check if email is already invited
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: 'Database error'
      });
    }

    if (row) {
      // Email already invited, return existing invite_id
      return res.json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const invite_id = uuidv4();
    
    db.run('INSERT INTO invitations (email, invite_id) VALUES (?, ?)', 
           [email, invite_id], 
           function(err) {
      if (err) {
        return res.status(500).json({
          message: 'Failed to create invitation'
        });
      }

      res.json({
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
    return res.status(400).json({
      message: 'invite_id, user_name, and password are required'
    });
  }

  // Validate invite_id
  db.get('SELECT email, used FROM invitations WHERE invite_id = ?', [invite_id], (err, invitation) => {
    if (err) {
      return res.status(500).json({
        message: 'Database error'
      });
    }

    if (!invitation) {
      return res.status(401).json({
        message: 'Invalid invite_id'
      });
    }

    if (invitation.used) {
      return res.status(401).json({
        message: 'Invitation has already been used'
      });
    }

    // Check if username already exists
    db.get('SELECT id FROM users WHERE username = ?', [user_name], (err, user) => {
      if (err) {
        return res.status(500).json({
          message: 'Database error'
        });
      }

      if (user) {
        return res.status(400).json({
          message: 'Username already exists. Try providing different username.'
        });
      }

      // Hash password
      const saltRounds = 10;
      bcrypt.hash(password, saltRounds, (bcryptErr, password_hash) => {
        if (bcryptErr) {
          return res.status(500).json({
            message: 'Password hashing failed'
          });
        }

        // Create user
        db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
               [user_name, invitation.email, password_hash],
               function(err) {
          if (err) {
            return res.status(500).json({
              message: 'Failed to create user'
            });
          }

          // Mark invitation as used
          db.run('UPDATE invitations SET used = TRUE WHERE invite_id = ?', [invite_id], (err) => {
            if (err) {
              console.error('Failed to mark invitation as used:', err);
            }
          });

          res.json({
            message: 'User created successfully'
          });
        });
      });
    });
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});