require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create users table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('Error creating table');
    process.exit(1);
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

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

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input (CWE-703)
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = uuidv4();

    // Insert user (CWE-915: Only insert allowed fields)
    db.run(
      'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)',
      [userId, email, hashedPassword, name],
      (err) => {
        if (err) {
          // CWE-209: Generic error message
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    // CWE-209: Don't expose internal errors
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input (CWE-703)
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err || !user) {
        // CWE-209: Generic error message
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Verify password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { id: user.id, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({
          token: token,
          message: 'Login successful'
        });
      } catch (error) {
        // CWE-209: Generic error message
        res.status(401).json({ message: 'Invalid email or password' });
      }
    });
  } catch (error) {
    // CWE-209: Generic error message
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// GET /profile
app.get('/profile', authenticateToken, (req, res) => {
  try {
    db.get('SELECT email, name FROM users WHERE id = ?', [req.user.id], (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      res.status(200).json({
        email: user.email,
        name: user.name
      });
    });
  } catch (error) {
    // CWE-209: Generic error message
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// PUT /profile
app.put('/profile', authenticateToken, (req, res) => {
  try {
    // CWE-915: Mass assignment protection - only allow name and email
    const allowedFields = ['name', 'email'];
    const updates = {};
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return res.status(200).json({ message: 'Profile updated' });
    }

    // Validate email if provided
    if (updates.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updates.email)) {
        return res.status(400).json({ message: 'Invalid data' });
      }
    }

    // Build SQL query dynamically based on provided fields
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map(field => `${field} = ?`).join(', ');

    db.run(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      [...values, req.user.id],
      (err) => {
        if (err) {
          // CWE-209: Generic error message
          return res.status(400).json({ message: 'Invalid data' });
        }
        res.status(200).json({ message: 'Profile updated' });
      }
    );
  } catch (error) {
    // CWE-209: Generic error message
    res.status(400).json({ message: 'Invalid data' });
  }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});