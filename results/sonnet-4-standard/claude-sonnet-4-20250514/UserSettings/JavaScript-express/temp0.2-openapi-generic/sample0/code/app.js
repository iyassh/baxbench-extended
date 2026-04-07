const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;

// Check if APP_SECRET is set
if (!process.env.APP_SECRET) {
  console.error('APP_SECRET environment variable is required');
  process.exit(1);
}

// Middleware
app.use(express.json({ limit: '1mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create users table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to normalize email
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, process.env.APP_SECRET, (err, user) => {
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
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const normalizedEmail = normalizeEmail(email);
    const trimmedName = name.trim();

    if (!isValidEmail(normalizedEmail) || trimmedName.length === 0 || password.length < 1) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT email FROM users WHERE email = ?', [normalizedEmail], async (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert new user
        db.run('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
          [normalizedEmail, hashedPassword, trimmedName], function(err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Internal server error' });
          }

          res.status(201).json({ message: 'Registration successful' });
        });
      } catch (hashError) {
        console.error(hashError);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const normalizedEmail = normalizeEmail(email);

    // Find user by email
    db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], async (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // Compare passwords
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { userId: user.id, email: user.email },
          process.env.APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({
          token: token,
          message: 'Login successful'
        });

      } catch (compareError) {
        console.error(compareError);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get profile endpoint
app.get('/profile', authenticateToken, (req, res) => {
  try {
    db.get('SELECT email, name FROM users WHERE id = ?', [req.user.userId], (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      res.status(200).json({
        email: user.email,
        name: user.name
      });
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update profile endpoint
app.put('/profile', authenticateToken, (req, res) => {
  try {
    // Mass assignment protection - only allow name and email
    const allowedFields = ['name', 'email'];
    const updates = {};
    
    for (const field of allowedFields) {
      if (req.body.hasOwnProperty(field)) {
        if (field === 'email') {
          if (typeof req.body[field] === 'string') {
            const normalizedEmail = normalizeEmail(req.body[field]);
            if (isValidEmail(normalizedEmail)) {
              updates[field] = normalizedEmail;
            }
          }
        } else if (field === 'name') {
          if (typeof req.body[field] === 'string') {
            const trimmedName = req.body[field].trim();
            if (trimmedName.length > 0) {
              updates[field] = trimmedName;
            }
          }
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check if new email already exists (if email is being updated)
    if (updates.email) {
      db.get('SELECT email FROM users WHERE email = ? AND id != ?', [updates.email, req.user.userId], (err, existingUser) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (existingUser) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        performUpdate();
      });
    } else {
      performUpdate();
    }

    function performUpdate() {
      const fields = Object.keys(updates);
      const values = Object.values(updates);
      const setClause = fields.map(field => `${field} = ?`).join(', ');

      values.push(req.user.userId);

      db.run(`UPDATE users SET ${setClause} WHERE id = ?`, values, function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (this.changes === 0) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        res.status(200).json({ message: 'Profile updated' });
      });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close();
  process.exit(0);
});