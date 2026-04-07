require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const SECRET = process.env.APP_SECRET || 'default-secret-key-change-me';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create users table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
  )
`, (err) => {
  if (err) {
    console.error('Database initialization error');
    process.exit(1);
  }
});

// Helper function to validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to extract allowed fields only (mass assignment protection)
function extractAllowedFields(body, allowedFields) {
  const result = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
}

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    // Extract only allowed fields (mass assignment protection)
    const allowedFields = ['email', 'password', 'name'];
    const userData = extractAllowedFields(req.body, allowedFields);
    
    const { email, password, name } = userData;

    // Validate required fields
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Validate password
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Hash password
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
          console.error('Database error during registration');
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    console.error('Registration error');
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    // Extract only allowed fields (mass assignment protection)
    const allowedFields = ['email', 'password'];
    const loginData = extractAllowedFields(req.body, allowedFields);
    
    const { email, password } = loginData;

    // Validate required fields
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Find user in database
    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          console.error('Database error during login');
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!user) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        try {
          // Verify password
          const validPassword = await bcrypt.compare(password, user.password);
          if (!validPassword) {
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          // Generate JWT token
          const token = jwt.sign(
            { id: user.id, email: user.email },
            SECRET,
            { expiresIn: '24h' }
          );

          res.status(200).json({
            token: token,
            message: 'Login successful'
          });
        } catch (compareErr) {
          console.error('Password comparison error');
          return res.status(401).json({ message: 'Invalid email or password' });
        }
      }
    );
  } catch (error) {
    console.error('Login error');
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// Get profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
  try {
    db.get(
      'SELECT email, name FROM users WHERE id = ?',
      [req.user.id],
      (err, user) => {
        if (err) {
          console.error('Database error while fetching profile');
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
  } catch (error) {
    console.error('Profile fetch error');
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// Update profile endpoint
app.put('/profile', authenticateToken, async (req, res) => {
  try {
    // Extract only allowed fields (mass assignment protection)
    const allowedFields = ['email', 'name'];
    const updateData = extractAllowedFields(req.body, allowedFields);

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({ message: 'Profile updated' });
    }

    // Validate email format if provided
    if (updateData.email && !isValidEmail(updateData.email)) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Build dynamic UPDATE query
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updateData)) {
      updates.push(`${key} = ?`);
      values.push(value);
    }
    
    values.push(req.user.id);
    
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    
    db.run(query, values, function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          console.error('Constraint error during profile update');
          return res.status(401).json({ message: 'Unauthorized' });
        }
        console.error('Database error during profile update');
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (this.changes === 0) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      res.status(200).json({ message: 'Profile updated' });
    });
  } catch (error) {
    console.error('Profile update error');
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});