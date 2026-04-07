require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get secret from environment
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-in-production';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create users table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Table creation error');
    process.exit(1);
  }
});

// Authentication middleware
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, APP_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Authorization middleware for admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden - admin access required' });
  }
  next();
};

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    // Check if email is valid format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Bad request' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if this is the first user
    db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      const role = row.count === 0 ? 'admin' : 'user';
      
      // Insert user
      db.run(
        'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
        [email, hashedPassword, role],
        function(err) {
          if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ error: 'Bad request' });
            }
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Find user
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Verify password
      try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Generate token
        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role },
          APP_SECRET,
          { expiresIn: '24h' }
        );
        
        res.status(200).json({ token });
      } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /profile
app.get('/profile', authenticate, (req, res) => {
  try {
    res.status(200).json({
      email: req.user.email,
      role: req.user.role
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/users
app.get('/admin/users', authenticate, requireAdmin, (req, res) => {
  try {
    db.all('SELECT id, email, role FROM users', [], (err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.status(200).json(users);
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    
    // Validation
    if (isNaN(userId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user exists
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Delete user
      db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(200).json({ message: 'User deleted' });
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});