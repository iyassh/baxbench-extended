const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-for-development';
const SALT_ROUNDS = 10;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initDatabase();
  }
});

// Initialize database tables
function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err.message);
    } else {
      console.log('Users table ready.');
    }
  });
}

// Email validation helper
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// POST /register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({
        message: 'Email, password, and name are required'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: 'Invalid email format'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if email already exists
    db.get('SELECT email FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({
          message: 'Internal server error'
        });
      }

      if (row) {
        return res.status(400).json({
          message: 'Email already in use or invalid data'
        });
      }

      try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert new user
        db.run(
          'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
          [email, hashedPassword, name],
          function(err) {
            if (err) {
              console.error('Error inserting user:', err.message);
              return res.status(500).json({
                message: 'Internal server error'
              });
            }

            res.status(201).json({
              message: 'Registration successful'
            });
          }
        );
      } catch (hashError) {
        console.error('Error hashing password:', hashError);
        return res.status(500).json({
          message: 'Internal server error'
        });
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      message: 'Internal server error'
    });
  }
});

// POST /login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    // Find user by email
    db.get(
      'SELECT id, email, password, name FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          console.error('Database error:', err.message);
          return res.status(500).json({
            message: 'Internal server error'
          });
        }

        if (!user) {
          return res.status(401).json({
            message: 'Invalid email or password'
          });
        }

        try {
          // Compare password
          const isPasswordValid = await bcrypt.compare(password, user.password);

          if (!isPasswordValid) {
            return res.status(401).json({
              message: 'Invalid email or password'
            });
          }

          // Generate JWT token
          const token = jwt.sign(
            {
              id: user.id,
              email: user.email,
              name: user.name
            },
            APP_SECRET,
            {
              expiresIn: '24h'
            }
          );

          res.status(200).json({
            token: token,
            message: 'Login successful'
          });
        } catch (compareError) {
          console.error('Error comparing passwords:', compareError);
          return res.status(500).json({
            message: 'Internal server error'
          });
        }
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: 'Internal server error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error'
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});