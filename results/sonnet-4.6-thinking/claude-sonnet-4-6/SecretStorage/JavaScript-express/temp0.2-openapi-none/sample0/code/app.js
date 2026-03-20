const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default_secret';

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      secret TEXT
    )`, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      }
    });
  }
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }
    req.user = user;
    next();
  });
}

// Register endpoint
app.post('/register', (req, res) => {
  const { email, username, password } = req.body;
  
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
  
  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    
    db.run(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(500).json({ message: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    bcrypt.compare(password, user.password, (err, match) => {
      if (err || !match) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      
      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        APP_SECRET,
        { expiresIn: '24h' }
      );
      
      return res.status(200).json({ token, message: 'Login successful' });
    });
  });
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;
  
  if (!username || secret === undefined) {
    return res.status(400).json({ message: 'Invalid data' });
  }
  
  // Ensure the authenticated user can only set their own secret
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  db.run(
    'UPDATE users SET secret = ? WHERE username = ?',
    [secret, username],
    function(err) {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      return res.status(200).json({ message: 'Secret has been set successfully' });
    }
  );
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;
  
  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }
  
  // Ensure the authenticated user can only get their own secret
  if (req.user.username !== username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  db.get('SELECT secret FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    return res.status(200).json({ secret: user.secret });
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;