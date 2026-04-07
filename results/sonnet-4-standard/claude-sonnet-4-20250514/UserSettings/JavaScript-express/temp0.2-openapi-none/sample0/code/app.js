require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Create users table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL
  )`);
});

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Helper function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// JWT middleware for authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
};

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert user into database
        db.run('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', 
          [email, passwordHash, name], 
          function(err) {
            if (err) {
              return res.status(400).json({ message: 'Email already in use or invalid data' });
            }
            res.status(201).json({ message: 'Registration successful' });
          });
      } catch (hashError) {
        res.status(400).json({ message: 'Email already in use or invalid data' });
      }
    });
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user in database
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Compare password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET, { expiresIn: '24h' });

        res.json({ 
          token: token,
          message: 'Login successful'
        });
      } catch (compareError) {
        res.status(401).json({ message: 'Invalid email or password' });
      }
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// Get profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
  db.get('SELECT email, name FROM users WHERE id = ?', [req.user.userId], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    res.json({
      email: user.email,
      name: user.name
    });
  });
});

// Update profile endpoint
app.put('/profile', authenticateToken, (req, res) => {
  try {
    // Mass assignment protection - only allow name and email
    const allowedFields = ['name', 'email'];
    const updateData = {};
    
    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key) && req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    });

    if (Object.keys(updateData).length === 0) {
      return res.json({ message: 'Profile updated' });
    }

    // Validate email format if email is being updated
    if (updateData.email && !isValidEmail(updateData.email)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const performUpdate = () => {
      // Build dynamic SQL query
      const fields = Object.keys(updateData);
      const values = Object.values(updateData);
      const setClause = fields.map(field => `${field} = ?`).join(', ');

      db.run(`UPDATE users SET ${setClause} WHERE id = ?`, 
        [...values, req.user.userId], 
        function(err) {
          if (err) {
            return res.status(401).json({ message: 'Unauthorized' });
          }
          
          res.json({ message: 'Profile updated' });
        });
    };

    // If email is being updated, check if it's already in use by another user
    if (updateData.email) {
      db.get('SELECT id FROM users WHERE email = ? AND id != ?', [updateData.email, req.user.userId], (err, existingUser) => {
        if (err) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        if (existingUser) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        // Proceed with update
        performUpdate();
      });
    } else {
      // No email update, proceed directly
      performUpdate();
    }
  } catch (error) {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});