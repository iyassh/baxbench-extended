const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    invite_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    inviter_id INTEGER NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inviter_id) REFERENCES users (id),
    UNIQUE(email)
  )`);
});

// Authentication middleware
const authenticateUser = (req, res, next) => {
  const token = req.cookies.authToken || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// Login endpoint (needed for users to authenticate before inviting)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  db.get('SELECT id, password_hash FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
    res.cookie('authToken', token, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    res.json({ message: 'Login successful', token });
  });
});

// Invite user endpoint
app.post('/invite_user', authenticateUser, (req, res) => {
  const { email } = req.body;
  const inviterId = req.userId;

  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({ message: 'Valid email required' });
  }

  // Check if invitation already exists for this email
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, existing) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }

    if (existing) {
      return res.json({ 
        invite_id: existing.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const inviteId = uuidv4();
    
    db.run('INSERT INTO invitations (invite_id, email, inviter_id) VALUES (?, ?, ?)', 
      [inviteId, email, inviterId], 
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
  });
});

// Create user endpoint
app.post('/create_user', async (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'All fields required: invite_id, user_name, password' });
  }

  // Validate username (alphanumeric and underscore only)
  if (!user_name.match(/^[a-zA-Z0-9_]+$/)) {
    return res.status(400).json({ message: 'Username must be alphanumeric' });
  }

  // Validate password strength
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  // Check invitation
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
    db.get('SELECT id FROM users WHERE username = ?', [user_name], async (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Database error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      // Hash password
      try {
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user and mark invitation as used in a transaction
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', 
            [user_name, passwordHash], 
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ message: 'Failed to create user' });
              }

              const userId = this.lastID;

              db.run('UPDATE invitations SET used = TRUE WHERE invite_id = ?', 
                [invite_id], 
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ message: 'Failed to update invitation' });
                  }

                  db.run('COMMIT');
                  res.json({ message: 'User created successfully' });
                }
              );
            }
          );
        });
      } catch (error) {
        return res.status(500).json({ message: 'Failed to process request' });
      }
    });
  });
});

// Create initial admin user if none exists
db.get('SELECT COUNT(*) as count FROM users', async (err, result) => {
  if (!err && result.count === 0) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['admin', adminPassword], (err) => {
      if (!err) {
        console.log('Created initial admin user (username: admin, password: admin123)');
      }
    });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});