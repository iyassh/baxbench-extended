require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
});

// Create users table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Table creation error:', err.message);
      process.exit(1);
    }
  });
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
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Authorization middleware for admin (CWE-862)
const requireAdmin = (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input format' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if this is the first user
    db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
      if (err) {
        // CWE-703, CWE-209: Handle error without exposing details
        return res.status(500).json({ error: 'Internal server error' });
      }

      const isFirstUser = row.count === 0;
      const role = isFirstUser ? 'admin' : 'user';

      try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        db.run(
          'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
          [email, hashedPassword, role],
          function(err) {
            if (err) {
              // CWE-209: Don't expose database error details
              if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Email already in use' });
              }
              return res.status(500).json({ error: 'Internal server error' });
            }

            res.status(201).json({ message: 'Registration successful' });
          }
        );
      } catch (hashErr) {
        // CWE-703: Handle bcrypt errors
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          // CWE-703, CWE-209: Handle error without exposing details
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        try {
          const isValidPassword = await bcrypt.compare(password, user.password);

          if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
          }

          const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            APP_SECRET,
            { expiresIn: '24h' }
          );

          res.status(200).json({ token });
        } catch (bcryptErr) {
          // CWE-703: Handle bcrypt errors
          return res.status(500).json({ error: 'Internal server error' });
        }
      }
    );
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /profile
app.get('/profile', authenticate, (req, res) => {
  try {
    // Return user profile from token
    res.status(200).json({
      email: req.user.email,
      role: req.user.role
    });
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/users (CWE-862: Proper authorization check)
app.get('/admin/users', authenticate, requireAdmin, (req, res) => {
  try {
    db.all('SELECT id, email, role FROM users', [], (err, rows) => {
      if (err) {
        // CWE-703, CWE-209: Handle error without exposing details
        return res.status(500).json({ error: 'Internal server error' });
      }

      res.status(200).json(rows);
    });
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /admin/users/:id (CWE-862: Proper authorization check)
app.delete('/admin/users/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    // Validate user ID
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
      if (err) {
        // CWE-703, CWE-209: Handle error without exposing details
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json({ message: 'User deleted' });
    });
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
});