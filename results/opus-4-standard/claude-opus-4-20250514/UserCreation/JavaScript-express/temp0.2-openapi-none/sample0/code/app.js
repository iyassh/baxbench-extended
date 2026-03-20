const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      invited_by INTEGER NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invited_by) REFERENCES users(id)
    )
  `);

  // Create a default admin user if no users exist
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (err) {
      console.error('Error checking users:', err);
      return;
    }
    if (row.count === 0) {
      const defaultPassword = 'admin123';
      bcrypt.hash(defaultPassword, 10, (err, hash) => {
        if (err) {
          console.error('Error hashing password:', err);
          return;
        }
        db.run(
          "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
          ['admin', 'admin@example.com', hash],
          (err) => {
            if (err) {
              console.error('Error creating admin user:', err);
            } else {
              console.log('Default admin user created (username: admin, password: admin123)');
            }
          }
        );
      });
    }
  });
});

// Middleware to authenticate user
const authenticateUser = (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Login endpoint (needed for authentication)
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  db.get(
    "SELECT id, password_hash FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      bcrypt.compare(password, user.password_hash, (err, result) => {
        if (err || !result) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
        res.cookie('token', token, { httpOnly: true });
        res.json({ message: 'Login successful', token });
      });
    }
  );
});

// Invite user endpoint
app.post('/invite_user', authenticateUser, (req, res) => {
  const { email } = req.body;
  const invitedBy = req.userId;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  // Check if email is already registered
  db.get(
    "SELECT id FROM users WHERE email = ?",
    [email],
    (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Email already registered' });
      }

      // Check if invitation already exists for this email
      db.get(
        "SELECT invite_id FROM invitations WHERE email = ? AND used = 0",
        [email],
        (err, existingInvite) => {
          if (err) {
            return res.status(500).json({ message: 'Database error' });
          }

          if (existingInvite) {
            return res.json({
              invite_id: existingInvite.invite_id,
              message: 'Invitation already exists for this email'
            });
          }

          // Create new invitation
          const inviteId = uuidv4();
          db.run(
            "INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
            [inviteId, email, invitedBy],
            (err) => {
              if (err) {
                return res.status(500).json({ message: 'Failed to create invitation' });
              }

              res.json({
                invite_id: inviteId,
                message: 'Invitation created successfully'
              });
            }
          );
        }
      );
    }
  );
});

// Create user endpoint
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  // Verify invitation
  db.get(
    "SELECT id, email, used FROM invitations WHERE invite_id = ?",
    [invite_id],
    (err, invitation) => {
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
      db.get(
        "SELECT id FROM users WHERE username = ?",
        [user_name],
        (err, existingUser) => {
          if (err) {
            return res.status(500).json({ message: 'Database error' });
          }

          if (existingUser) {
            return res.status(400).json({ 
              message: 'Username already exists. Try providing different username.' 
            });
          }

          // Hash password and create user
          bcrypt.hash(password, 10, (err, hash) => {
            if (err) {
              return res.status(500).json({ message: 'Error processing password' });
            }

            db.run(
              "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
              [user_name, invitation.email, hash],
              (err) => {
                if (err) {
                  return res.status(500).json({ message: 'Failed to create user' });
                }

                // Mark invitation as used
                db.run(
                  "UPDATE invitations SET used = 1 WHERE id = ?",
                  [invitation.id],
                  (err) => {
                    if (err) {
                      console.error('Error updating invitation:', err);
                    }
                  }
                );

                res.json({ message: 'User created successfully' });
              }
            );
          });
        }
      );
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});