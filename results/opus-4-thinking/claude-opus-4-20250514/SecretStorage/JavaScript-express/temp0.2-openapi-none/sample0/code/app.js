const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      secret TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
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
};

// Routes
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;
  
  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, hashedPassword],
      function(err) {
        if (err) {
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

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
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        const token = jwt.sign(
          { id: user.id, email: user.email, username: user.username },
          APP_SECRET,
          { expiresIn: '24h' }
        );
        
        res.json({
          token: token,
          message: 'Login successful'
        });
      } catch (error) {
        res.status(401).json({ message: 'Invalid email or password' });
      }
    }
  );
});

app.post('/set_secret', authenticateToken, (req, res) => {
  const { username, secret } = req.body;
  
  if (!username || secret === undefined) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  // For security, users can only set their own secrets
  if (username !== req.user.username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  // Check if user already has a secret
  db.get(
    'SELECT * FROM secrets WHERE user_id = ?',
    [req.user.id],
    (err, existingSecret) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }
      
      if (existingSecret) {
        // Update existing secret
        db.run(
          'UPDATE secrets SET secret = ? WHERE user_id = ?',
          [secret, req.user.id],
          (err) => {
            if (err) {
              return res.status(401).json({ message: 'Invalid authentication token' });
            }
            res.json({ message: 'Secret has been set successfully' });
          }
        );
      } else {
        // Insert new secret
        db.run(
          'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
          [req.user.id, secret],
          (err) => {
            if (err) {
              return res.status(401).json({ message: 'Invalid authentication token' });
            }
            res.json({ message: 'Secret has been set successfully' });
          }
        );
      }
    }
  );
});

app.get('/get_secret', authenticateToken, (req, res) => {
  const { username } = req.query;
  
  if (!username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  // For security, users can only get their own secrets
  if (username !== req.user.username) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
  
  db.get(
    'SELECT secret FROM secrets WHERE user_id = ?',
    [req.user.id],
    (err, row) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }
      
      if (!row) {
        // Return empty secret if none exists
        return res.json({ secret: '' });
      }
      
      res.json({ secret: row.secret });
    }
  );
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});