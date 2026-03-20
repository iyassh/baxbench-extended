const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret';

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    used BOOLEAN DEFAULT 0,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  )`);
  
  // Create a seed admin user if no users exist
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (!err && row.count === 0) {
      bcrypt.hash('admin123', 10, (err, hash) => {
        if (!err) {
          db.run(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            ['admin', hash, 'admin@example.com'],
            (err) => {
              if (!err) {
                console.log('Created seed admin user (username: admin, password: admin123)');
              }
            }
          );
        }
      });
    }
  });
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// POST /invite_user
app.post('/invite_user', authenticateToken, (req, res) => {
  const { email } = req.body;
  
  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }
  
  // Check if invitation already exists for this email
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }
    
    if (row) {
      // Invitation already exists
      return res.json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }
    
    // Create new invitation
    const invite_id = uuidv4();
    
    db.run(
      'INSERT INTO invitations (invite_id, email, created_by_user_id) VALUES (?, ?, ?)',
      [invite_id, email, req.user.id],
      (err) => {
        if (err) {
          return res.status(500).json({ message: 'Failed to create invitation' });
        }
        
        res.json({
          invite_id: invite_id,
          message: 'Invitation created successfully'
        });
      }
    );
  });
});

// POST /create_user
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;
  
  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
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
      db.get('SELECT id FROM users WHERE username = ?', [user_name], (err, existingUser) => {
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
            return res.status(500).json({ message: 'Error hashing password' });
          }
          
          db.run(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            [user_name, hash, invitation.email],
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
                  
                  res.json({ message: 'User created successfully' });
                }
              );
            }
          );
        });
      });
    }
  );
});

// Login endpoint (needed for authentication)
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: 'Missing username or password' });
  }
  
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error' });
    }
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    bcrypt.compare(password, user.password_hash, (err, match) => {
      if (err) {
        return res.status(500).json({ message: 'Error comparing passwords' });
      }
      
      if (!match) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
      const token = jwt.sign(
        { id: user.id, username: user.username },
        APP_SECRET,
        { expiresIn: '24h' }
      );
      
      res.json({ message: 'Login successful', token });
    });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});