const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security: Get secret from environment variable
const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
  console.error('ERROR: APP_SECRET environment variable is not set');
  process.exit(1);
}

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Database initialization
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create users table with parameterized schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Table creation error:', err.message);
    }
  });

  // Create login attempts table for rate limiting
  db.run(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Login attempts table creation error:', err.message);
    }
  });
});

// Rate limiting helper - check failed login attempts
const checkRateLimit = (email, callback) => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  db.get(
    'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempted_at > ?',
    [email, fiveMinutesAgo],
    (err, row) => {
      if (err) {
        return callback(err, false);
      }
      // Allow max 5 attempts in 5 minutes
      callback(null, row.count >= 5);
    }
  );
};

// Record failed login attempt
const recordFailedAttempt = (email) => {
  db.run(
    'INSERT INTO login_attempts (email) VALUES (?)',
    [email],
    (err) => {
      if (err) {
        console.error('Error recording login attempt:', err.message);
      }
    }
  );
};

// Clear login attempts on successful login
const clearLoginAttempts = (email) => {
  db.run(
    'DELETE FROM login_attempts WHERE email = ?',
    [email],
    (err) => {
      if (err) {
        console.error('Error clearing login attempts:', err.message);
      }
    }
  );
};

// Validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate password strength
const isValidPassword = (password) => {
  return password && password.length >= 8;
};

// POST /register - User registration
app.post('/register', (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Input validation
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password, and name are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'Name must be a non-empty string' });
    }

    // Hash password
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
        console.error('Password hashing error:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
      }

      const userId = require('uuid').v4();

      // Use parameterized query to prevent SQL injection
      db.run(
        'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)',
        [userId, email, hashedPassword, name.trim()],
        (err) => {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              return res.status(400).json({ message: 'Email already in use or invalid data' });
            }
            console.error('Database error:', err.message);
            return res.status(500).json({ message: 'Internal server error' });
          }

          res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /login - User login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!isValidEmail(email)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check rate limiting
    checkRateLimit(email, (err, isRateLimited) => {
      if (err) {
        console.error('Rate limit check error:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (isRateLimited) {
        return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
      }

      // Use parameterized query to prevent SQL injection
      db.get(
        'SELECT id, email, password, name FROM users WHERE email = ?',
        [email],
        (err, user) => {
          if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ message: 'Internal server error' });
          }

          if (!user) {
            recordFailedAttempt(email);
            return res.status(401).json({ message: 'Invalid email or password' });
          }

          // Compare passwords
          bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
              console.error('Password comparison error:', err.message);
              return res.status(500).json({ message: 'Internal server error' });
            }

            if (!isMatch) {
              recordFailedAttempt(email);
              return res.status(401).json({ message: 'Invalid email or password' });
            }

            // Clear login attempts on successful login
            clearLoginAttempts(email);

            // Generate JWT with expiration (1 hour)
            const token = jwt.sign(
              { userId: user.id, email: user.email },
              APP_SECRET,
              { 
                algorithm: 'HS256',
                expiresIn: '1h'
              }
            );

            // Set secure cookie with HttpOnly and SameSite flags
            res.cookie('token', token, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'Strict',
              maxAge: 3600000 // 1 hour
            });

            res.status(200).json({ 
              token: token,
              message: 'Login successful' 
            });
          });
        }
      );
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      req.user = decoded;
      next();
    });
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ message: 'Server is running' });
});

// Protected endpoint example
app.get('/profile', verifyToken, (req, res) => {
  res.status(200).json({ 
    message: 'Profile retrieved successfully',
    userId: req.user.userId,
    email: req.user.email
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Database close error:', err.message);
    }
    process.exit(0);
  });
});