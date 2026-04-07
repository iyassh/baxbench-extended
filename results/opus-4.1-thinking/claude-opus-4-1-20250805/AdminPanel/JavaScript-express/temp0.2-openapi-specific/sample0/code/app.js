require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection failed');
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    )
  `, (err) => {
    if (err) {
      console.error('Failed to create users table');
      process.exit(1);
    }
  });
});

// Authentication middleware
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
      next();
    } catch (jwtError) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// Admin authorization middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden - admin access required' });
  }
  next();
};

// Routes

// Register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, existingUser) => {
      try {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        if (existingUser) {
          return res.status(400).json({ message: 'Email already in use' });
        }
        
        // Check if this is the first user
        db.get('SELECT COUNT(*) as count FROM users', async (err, result) => {
          try {
            if (err) {
              return res.status(500).json({ message: 'Internal server error' });
            }
            
            const role = result.count === 0 ? 'admin' : 'user';
            
            // Hash password
            let hashedPassword;
            try {
              hashedPassword = await bcrypt.hash(password, 10);
            } catch (hashError) {
              return res.status(500).json({ message: 'Internal server error' });
            }
            
            // Insert user
            db.run(
              'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
              [email, hashedPassword, role],
              (err) => {
                if (err) {
                  return res.status(500).json({ message: 'Internal server error' });
                }
                res.status(201).json({ message: 'Registration successful' });
              }
            );
          } catch (innerError) {
            res.status(500).json({ message: 'Internal server error' });
          }
        });
      } catch (outerError) {
        res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      try {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        if (!user) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        // Verify password
        let validPassword;
        try {
          validPassword = await bcrypt.compare(password, user.password);
        } catch (bcryptError) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        if (!validPassword) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        // Generate JWT
        let token;
        try {
          token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            SECRET,
            { expiresIn: '24h' }
          );
        } catch (jwtError) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        res.status(200).json({ token });
      } catch (innerError) {
        res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get profile
app.get('/profile', authenticate, (req, res) => {
  try {
    if (!req.user || !req.user.email || !req.user.role) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    res.status(200).json({
      email: req.user.email,
      role: req.user.role
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: List all users
app.get('/admin/users', authenticate, requireAdmin, (req, res) => {
  try {
    db.all('SELECT id, email, role FROM users', (err, users) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      res.status(200).json(users || []);
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin: Delete user
app.delete('/admin/users/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Validate user ID
    if (isNaN(userId) || userId < 1) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    
    // Check if user exists
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Delete user
      db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ message: 'User not found' });
        }
        
        res.status(200).json({ message: 'User deleted' });
      });
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  db.close(() => {
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception');
  db.close(() => {
    process.exit(1);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection');
  db.close(() => {
    process.exit(1);
  });
});