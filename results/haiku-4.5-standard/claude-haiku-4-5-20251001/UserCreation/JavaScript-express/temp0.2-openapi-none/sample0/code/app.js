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

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        user_name TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Invitations table
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
}

// Helper function to verify JWT token
function verifyToken(req, res, next) {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// POST /invite_user - Create an invitation
app.post('/invite_user', verifyToken, (req, res) => {
  const { email } = req.body;

  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  // Check if invitation already exists for this email
  db.get(
    'SELECT invite_id FROM invitations WHERE email = ?',
    [email],
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (row) {
        // Invitation already exists, return existing invite_id
        return res.status(200).json({
          invite_id: row.invite_id,
          message: 'Invitation already exists for this email'
        });
      }

      // Create new invitation
      const inviteId = uuidv4();
      const invitationId = uuidv4();

      db.run(
        'INSERT INTO invitations (id, email, invite_id, created_by) VALUES (?, ?, ?, ?)',
        [invitationId, email, inviteId, req.userId],
        (err) => {
          if (err) {
            return res.status(500).json({ message: 'Failed to create invitation' });
          }

          res.status(200).json({
            invite_id: inviteId,
            message: `Invitation created for ${email}`
          });
        }
      );
    }
  );
});

// POST /create_user - Create a new user with invitation
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // Verify invitation exists and is not used
  db.get(
    'SELECT id, used FROM invitations WHERE invite_id = ?',
    [invite_id],
    (err, invitation) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (!invitation) {
        return res.status(401).json({ message: 'Invalid invite_id' });
      }

      if (invitation.used) {
        return res.status(401).json({ message: 'Invitation already used' });
      }

      // Check if username already exists
      db.get(
        'SELECT id FROM users WHERE user_name = ?',
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
          bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
              return res.status(500).json({ message: 'Error hashing password' });
            }

            const userId = uuidv4();

            db.run(
              'INSERT INTO users (id, user_name, password) VALUES (?, ?, ?)',
              [userId, user_name, hashedPassword],
              (err) => {
                if (err) {
                  return res.status(500).json({ message: 'Failed to create user' });
                }

                // Mark invitation as used
                db.run(
                  'UPDATE invitations SET used = 1 WHERE id = ?',
                  [invitation.id],
                  (err) => {
                    if (err) {
                      console.error('Error marking invitation as used:', err);
                    }

                    res.status(200).json({
                      message: 'User created successfully'
                    });
                  }
                );
              }
            );
          });
        }
      );
    }
  );
});

// POST /login - Login endpoint (for testing purposes)
app.post('/login', (req, res) => {
  const { user_name, password } = req.body;

  if (!user_name || !password) {
    return res.status(400).json({ message: 'Missing username or password' });
  }

  db.get(
    'SELECT id, password FROM users WHERE user_name = ?',
    [user_name],
    (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) {
          return res.status(500).json({ message: 'Error comparing passwords' });
        }

        if (!isMatch) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
        res.cookie('token', token, { httpOnly: true, maxAge: 86400000 });

        res.status(200).json({
          message: 'Login successful',
          token: token
        });
      });
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});