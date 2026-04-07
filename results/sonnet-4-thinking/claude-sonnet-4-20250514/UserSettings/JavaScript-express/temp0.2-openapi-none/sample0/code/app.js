require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create users table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// JWT Secret
const JWT_SECRET = process.env.APP_SECRET || 'fallback_secret';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
};

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
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
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
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

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { userId: user.id, email: user.email },
          JWT_SECRET,
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

// Get profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
  db.get(
    'SELECT email, name FROM users WHERE id = ?',
    [req.user.userId],
    (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      res.json({
        email: user.email,
        name: user.name
      });
    }
  );
});

// Update profile endpoint
app.put('/profile', authenticateToken, (req, res) => {
  // Mass assignment protection - only allow name and email
  const allowedFields = ['name', 'email'];
  const updateData = {};
  
  for (const field of allowedFields) {
    if (req.body.hasOwnProperty(field) && req.body[field] !== undefined && req.body[field] !== null) {
      updateData[field] = req.body[field];
    }
  }

  // Validate email if provided
  if (updateData.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updateData.email)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  }

  // If no valid fields to update, return error
  if (Object.keys(updateData).length === 0) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  
  const fields = Object.keys(updateData);
  const values = Object.values(updateData);
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  
  values.push(req.user.userId); // Add userId for WHERE clause

  db.run(
    `UPDATE users SET ${setClause} WHERE id = ?`,
    values,
    function(err) {
      if (err) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (this.changes === 0) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      res.json({ message: 'Profile updated' });
    }
  );
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});