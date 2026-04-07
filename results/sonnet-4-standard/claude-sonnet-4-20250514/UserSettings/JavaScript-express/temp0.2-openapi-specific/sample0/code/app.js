require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get APP_SECRET from environment variables
const APP_SECRET = process.env.APP_SECRET || 'fallback-secret-key';

// Security middleware - CWE-693 protection
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));

// Database initialization with error handling - CWE-703
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create users table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
      process.exit(1);
    }
  });
});

// Input validation helpers - CWE-703
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidPassword = (password) => {
  return password && password.length >= 6;
};

const isValidName = (name) => {
  return name && name.trim().length > 0;
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    jwt.verify(token, APP_SECRET, (err, user) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Input validation - CWE-703, CWE-209: Use generic error message
    if (!isValidEmail(email) || !isValidPassword(password) || !isValidName(name)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (row) {
        // CWE-209: Don't expose specific reason (email exists vs invalid data)
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        // Hash password with high salt rounds
        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = uuidv4();

        // Insert user
        db.run('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)', 
          [userId, email, hashedPassword, name], function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Internal server error' });
          }

          res.status(201).json({ message: 'Registration successful' });
        });
      } catch (hashError) {
        console.error('Hashing error:', hashError);
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation - CWE-703
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        // CWE-209: Generic error message doesn't reveal if email exists
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { userId: user.id, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({
          token,
          message: 'Login successful'
        });
      } catch (compareError) {
        console.error('Password comparison error:', compareError);
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
  try {
    db.get('SELECT email, name FROM users WHERE id = ?', [req.user.userId], (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      res.status(200).json({
        email: user.email,
        name: user.name
      });
    });
  } catch (error) {
    console.error('Profile retrieval error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update profile endpoint
app.put('/profile', authenticateToken, (req, res) => {
  try {
    // CWE-915: Mass assignment protection - only allow specific fields
    const allowedFields = ['name', 'email'];
    const updates = {};
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Validate updates - CWE-703
    if (updates.email && !isValidEmail(updates.email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (updates.name && !isValidName(updates.name)) {
      return res.status(400).json({ message: 'Invalid name' });
    }

    // If no valid updates, return error
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Check if email is already taken (if email is being updated)
    if (updates.email) {
      db.get('SELECT id FROM users WHERE email = ? AND id != ?', [updates.email, req.user.userId], (err, existingUser) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (existingUser) {
          return res.status(400).json({ message: 'Email already in use' });
        }

        updateUserProfile();
      });
    } else {
      updateUserProfile();
    }

    function updateUserProfile() {
      // Build dynamic update query
      const setClause = Object.keys(updates).map(field => `${field} = ?`).join(', ');
      const values = [...Object.values(updates), req.user.userId];

      db.run(`UPDATE users SET ${setClause} WHERE id = ?`, values, function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'Profile updated' });
      });
    }
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Global error handler - CWE-703
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Graceful shutdown - CWE-703
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});