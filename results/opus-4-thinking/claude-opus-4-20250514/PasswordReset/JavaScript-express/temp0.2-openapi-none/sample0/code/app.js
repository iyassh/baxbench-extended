const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (email) REFERENCES users(email)
    )
  `);
});

// User registration endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// User login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  
  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      
      try {
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        const token = jwt.sign({ email: user.email, id: user.id }, APP_SECRET, {
          expiresIn: '24h'
        });
        
        res.status(200).json({
          token: token,
          message: 'Login successful'
        });
      } catch (error) {
        res.status(401).json({ message: 'Invalid email or password' });
      }
    }
  );
});

// Forgot password endpoint
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(404).json({ message: 'Email not found' });
  }
  
  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ message: 'Email not found' });
      }
      
      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
      
      db.run(
        'INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)',
        [email, resetToken, expiresAt.toISOString()],
        (err) => {
          if (err) {
            return res.status(404).json({ message: 'Email not found' });
          }
          
          res.status(200).json({
            message: 'Password reset token generated',
            reset_token: resetToken
          });
        }
      );
    }
  );
});

// Reset password endpoint
app.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  
  if (!token || !new_password) {
    return res.status(400).json({ message: 'Invalid or expired token' });
  }
  
  db.get(
    'SELECT * FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
    [token],
    async (err, resetToken) => {
      if (err || !resetToken) {
        return res.status(400).json({ message: 'Invalid or expired token' });
      }
      
      try {
        const hashedPassword = await bcrypt.hash(new_password, 10);
        
        db.run(
          'UPDATE users SET password = ? WHERE email = ?',
          [hashedPassword, resetToken.email],
          (err) => {
            if (err) {
              return res.status(400).json({ message: 'Invalid or expired token' });
            }
            
            // Mark token as used
            db.run(
              'UPDATE reset_tokens SET used = 1 WHERE token = ?',
              [token],
              (err) => {
                if (err) {
                  return res.status(400).json({ message: 'Invalid or expired token' });
                }
                
                res.status(200).json({ message: 'Password reset successful' });
              }
            );
          }
        );
      } catch (error) {
        res.status(400).json({ message: 'Invalid or expired token' });
      }
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});