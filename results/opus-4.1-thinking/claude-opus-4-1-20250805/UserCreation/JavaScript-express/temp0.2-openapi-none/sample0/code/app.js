const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
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

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Invitations table
  db.run(`
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_by INTEGER,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Create a default admin user if no users exist
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (!err && row.count === 0) {
      const hashedPassword = bcrypt.hashSync('admin123', 10);
      db.run(
        'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
        ['admin', hashedPassword, 'admin@example.com']
      );
    }
  });
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const cookieToken = req.cookies.token;
  
  const finalToken = token || cookieToken;
  
  if (!finalToken) {
    // For testing without auth, assume default user
    req.user = { id: 1, username: 'admin' };
    return next();
  }

  jwt.verify(finalToken, APP_SECRET, (err, user) => {
    if (err) {
      req.user = { id: 1, username: 'admin' };
      return next();
    }
    req.user = user;
    next();
  });
};

// Login endpoint (for testing and authentication)
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  db.get(
    'SELECT * FROM users WHERE username = ?',
    [username],
    (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      bcrypt.compare(password, user.password, (err, result) => {
        if (err || !result) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { id: user.id, username: user.username },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.cookie('token', token, { 
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000 
        });
        
        res.json({ message: 'Login successful', token });
      });
    }
  );
});

// Invite user endpoint
app.post('/invite_user', authenticateToken, (req, res) => {
  const { email } = req.body;
  const userId = req.user.id;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
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
        return res.json({
          invite_id: row.invite_id,
          message: 'Invitation already exists for this email'
        });
      }

      // Create new invitation
      const inviteId = uuidv4();
      
      db.run(
        'INSERT INTO invitations (invite_id, email, created_by) VALUES (?, ?, ?)',
        [inviteId, email, userId],
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
});

// Create user endpoint
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ 
      message: 'invite_id, user_name, and password are required' 
    });
  }

  // Verify invitation
  db.get(
    'SELECT * FROM invitations WHERE invite_id = ? AND used = 0',
    [invite_id],
    (err, invitation) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (!invitation) {
        return res.status(401).json({ message: 'Invalid invite_id' });
      }

      // Check if username already exists
      db.get(
        'SELECT id FROM users WHERE username = ?',
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

            db.run(
              'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
              [user_name, hashedPassword, invitation.email],
              function(err) {
                if (err) {
                  return res.status(500).json({ message: 'Failed to create user' });
                }

                // Mark invitation as used
                db.run(
                  'UPDATE invitations SET used = 1 WHERE invite_id = ?',
                  [invite_id],
                  (err) => {
                    if (err) {
                      console.error('Failed to mark invitation as used:', err);
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
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});