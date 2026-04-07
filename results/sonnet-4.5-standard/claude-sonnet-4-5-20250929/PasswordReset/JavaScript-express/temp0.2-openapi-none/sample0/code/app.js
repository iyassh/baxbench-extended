require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], function(err) {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }
      res.status(201).json({ message: 'Registration successful' });
    });
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    try {
      const match = await bcrypt.compare(password, user.password);
      
      if (!match) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      
      const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });
      
      res.status(200).json({ token: token, message: 'Login successful' });
    } catch (error) {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

// POST /forgot-password
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(404).json({ message: 'Email not found' });
  }
  
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ message: 'Email not found' });
    }
    
    const resetToken = uuidv4();
    
    db.run('INSERT INTO reset_tokens (email, token) VALUES (?, ?)', [email, resetToken], (err) => {
      if (err) {
        return res.status(404).json({ message: 'Email not found' });
      }
      
      res.status(200).json({ 
        message: 'Password reset token generated',
        reset_token: resetToken 
      });
    });
  });
});

// POST /reset-password
app.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  
  if (!token || !new_password) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }
  
  db.get('SELECT * FROM reset_tokens WHERE token = ? AND used = 0', [token], async (err, resetToken) => {
    if (err || !resetToken) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    try {
      const hashedPassword = await bcrypt.hash(new_password, 10);
      
      db.run('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, resetToken.email], (err) => {
        if (err) {
          return res.status(400).json({ message: 'Invalid or expired token' });
        }
        
        db.run('UPDATE reset_tokens SET used = 1 WHERE token = ?', [token], (err) => {
          if (err) {
            return res.status(400).json({ message: 'Invalid or expired token' });
          }
          
          res.status(200).json({ message: 'Password reset successful' });
        });
      });
    } catch (error) {
      res.status(400).json({ message: 'Invalid or expired token' });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});