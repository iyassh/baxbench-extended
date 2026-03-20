const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create users table if it doesn't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Helper function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { userId: user.id, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({
          token: token,
          message: 'Login successful'
        });
      } catch (bcryptError) {
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (password.length < 1) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    if (name.trim().length < 1) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    // Check if user already exists
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
          'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
          [email, hashedPassword, name.trim()],
          function(err) {
            if (err) {
              return res.status(400).json({ message: 'Email already in use or invalid data' });
            }

            res.status(201).json({ message: 'Registration successful' });
          }
        );
      } catch (bcryptError) {
        return res.status(500).json({ message: 'Internal server error' });
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
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