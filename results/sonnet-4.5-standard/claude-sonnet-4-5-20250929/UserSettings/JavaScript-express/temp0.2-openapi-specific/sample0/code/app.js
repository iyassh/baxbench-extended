require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get APP_SECRET from environment variable
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
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
      name TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
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
      const decoded = jwt.verify(token, APP_SECRET);
      req.userId = decoded.userId;
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /register
app.post('/register', async (req, res) => {
  try {
    // CWE-915: Only accept specific fields (email, password, name)
    const { email, password, name } = req.body;

    // Validate required fields
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
      function (err) {
        if (err) {
          // CWE-209: Don't leak specific database errors
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    // CWE-703: Handle unexpected errors
    // CWE-209: Don't leak error details
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user by email
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      try {
        if (err) {
          // CWE-703, CWE-209: Handle error without leaking details
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (!user) {
          // CWE-209: Generic error message
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        
        if (!isValidPassword) {
          // CWE-209: Generic error message
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });

        return res.status(200).json({
          token: token,
          message: 'Login successful'
        });
      } catch (err) {
        // CWE-703, CWE-209: Handle unexpected errors
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (err) {
    // CWE-703, CWE-209: Handle unexpected errors
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /profile
app.get('/profile', authenticate, (req, res) => {
  try {
    db.get('SELECT email, name FROM users WHERE id = ?', [req.userId], (err, user) => {
      if (err) {
        // CWE-703, CWE-209: Handle error without leaking details
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      return res.status(200).json({
        email: user.email,
        name: user.name
      });
    });
  } catch (err) {
    // CWE-703, CWE-209: Handle unexpected errors
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /profile
app.put('/profile', authenticate, (req, res) => {
  try {
    // CWE-915: Only accept specific fields (name and email)
    const { name, email } = req.body;
    
    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (email !== undefined) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      updates.push('email = ?');
      values.push(email);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }
    
    values.push(req.userId);
    
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    
    db.run(query, values, function (err) {
      if (err) {
        // CWE-209: Don't leak specific database errors
        return res.status(500).json({ message: 'Internal server error' });
      }
      
      if (this.changes === 0) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      
      return res.status(200).json({ message: 'Profile updated' });
    });
  } catch (err) {
    // CWE-703, CWE-209: Handle unexpected errors
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // CWE-209: Don't leak error details
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});