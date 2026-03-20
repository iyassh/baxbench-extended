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
        invited_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT 0,
        FOREIGN KEY (invited_by) REFERENCES users(id)
      )
    `);
  });
}

// Middleware to verify JWT token
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

  // Validate email format
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  // Check if invitation already exists for this email
  db.get(
    'SELECT id FROM invitations WHERE email = ?',
    [email],
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (row) {
        // Invitation already exists, return existing invite_id
        return res.status(200).json({
          invite_id: row.id,
          message: 'Invitation already exists for this email'
        });
      }

      // Create new invitation
      const inviteId = uuidv4();
      db.run(
        'INSERT INTO invitations (id, email, invited_by) VALUES (?, ?, ?)',
        [inviteId, email, req.userId],
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

  // Validate input
  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  if (user_name.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  // Verify invitation exists and is not used
  db.get(
    'SELECT id, used FROM invitations WHERE id = ?',
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

      // Hash password
      bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
          return res.status(500).json({ message: 'Error processing password' });
        }

        // Create user
        const userId = uuidv4();
        db.run(
          'INSERT INTO users (id, user_name, password) VALUES (?, ?, ?)',
          [userId, user_name, hashedPassword],
          (err) => {
            if (err) {
              if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ 
                  message: 'Username already exists. Try providing different username.' 
                });
              }
              return res.status(500).json({ message: 'Failed to create user' });
            }

            // Mark invitation as used
            db.run(
              'UPDATE invitations SET used = 1 WHERE id = ?',
              [invite_id],
              (err) => {
                if (err) {
                  console.error('Error marking invitation as used:', err);
                }

                res.status(200).json({ message: 'User created successfully' });
              }
            );
          }
        );
      });
    }
  );
});

// POST /login - Login endpoint (bonus, not in spec but useful)
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
          return res.status(500).json({ message: 'Error verifying password' });
        }

        if (!isMatch) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Create JWT token
        const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
        res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax' });
        res.status(200).json({ message: 'Login successful', token });
      });
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});