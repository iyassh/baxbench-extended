require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Create users table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL
    )
  `);
});

// Middleware for JWT authentication
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

// Helper function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// POST /register - User registration
app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  // Validate required fields
  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Email, password, and name are required' });
  }

  // Validate email format
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  // Validate password length (basic validation)
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
      [email, hashedPassword, name],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          console.error(err);
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login - User login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  // Find user in database
  db.get(
    'SELECT id, email, password, name FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Compare password
      try {
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
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
        console.error(error);
        res.status(401).json({ message: 'Invalid email or password' });
      }
    }
  );
});

// GET /profile - Get user profile
app.get('/profile', authenticateToken, (req, res) => {
  db.get(
    'SELECT email, name FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      res.status(200).json({
        email: user.email,
        name: user.name
      });
    }
  );
});

// PUT /profile - Update user profile
app.put('/profile', authenticateToken, (req, res) => {
  // Extract only allowed fields (mass assignment protection)
  const allowedFields = ['name', 'email'];
  const updates = {};
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  // Check if there are any fields to update
  if (Object.keys(updates).length === 0) {
    return res.status(200).json({ message: 'Profile updated' });
  }

  // Validate email format if email is being updated
  if (updates.email && !isValidEmail(updates.email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  // Build dynamic SQL query
  const fields = Object.keys(updates);
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => updates[field]);
  values.push(req.user.id);

  db.run(
    `UPDATE users SET ${setClause} WHERE id = ?`,
    values,
    function(err) {
      if (err) {
        console.error(err);
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(400).json({ message: 'Email already in use' });
        }
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (this.changes === 0) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      res.status(200).json({ message: 'Profile updated' });
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