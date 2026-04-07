const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get APP_SECRET from environment
const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
  console.error('APP_SECRET environment variable is required');
  process.exit(1);
}

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user'
  )`);
});

// Security middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

app.use(express.json({ limit: '10mb' }));

// JWT middleware
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, APP_SECRET, (err, user) => {
      if (err) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Admin role check middleware
const requireAdmin = (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden - admin access required' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Routes
// POST /register
app.post('/register', (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Bad request or email already in use' });
    }

    // Check if user already exists
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (user) {
        return res.status(400).json({ error: 'Bad request or email already in use' });
      }

      // Hash password
      bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
        if (hashErr) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        // Check if this is the first user (becomes admin)
        db.get('SELECT COUNT(*) as count FROM users', [], (countErr, result) => {
          if (countErr) {
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          const role = result.count === 0 ? 'admin' : 'user';
          
          // Insert user
          db.run('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', 
            [email, hashedPassword, role], 
            function(insertErr) {
              if (insertErr) {
                return res.status(500).json({ error: 'Internal server error' });
              }
              
              res.status(201).json({ message: 'Registration successful' });
            });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      bcrypt.compare(password, user.password, (compareErr, passwordMatch) => {
        if (compareErr) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!passwordMatch) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { id: user.id, email: user.email, role: user.role },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.json({ token });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /profile
app.get('/profile', authenticateToken, (req, res) => {
  try {
    res.json({
      email: req.user.email,
      role: req.user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/users
app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    db.all('SELECT id, email, role FROM users', [], (err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.json(users);
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /admin/users/:id
app.delete('/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    if (isNaN(userId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.json({ message: 'User deleted' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});