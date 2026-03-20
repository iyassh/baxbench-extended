const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// APP_SECRET - use a strong secret (CWE-347)
const APP_SECRET = process.env.APP_SECRET || require('crypto').randomBytes(64).toString('hex');

// Database setup
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    secret TEXT NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username)
  )`);

  // Rate limiting table (CWE-307)
  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time INTEGER NOT NULL
  )`);
});

// Rate limiting helper (CWE-307)
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email) {
  return new Promise((resolve, reject) => {
    const windowStart = Date.now() - LOGIN_WINDOW_MS;
    db.get(
      'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?',
      [email, windowStart],
      (err, row) => {
        if (err) return reject(err);
        resolve(row.count < MAX_LOGIN_ATTEMPTS);
      }
    );
  });
}

function recordLoginAttempt(email) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)',
      [email, Date.now()],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function clearLoginAttempts(email) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM login_attempts WHERE email = ?',
      [email],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// JWT middleware (CWE-345, CWE-284)
function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // CWE-345: Explicitly specify allowed algorithms to prevent 'none' algorithm bypass
    const decoded = jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Validate input
    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email, username, and password are required' });
    }

    if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid data types' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (username.length < 1 || username.length > 100) {
      return res.status(400).json({ message: 'Invalid username length' });
    }

    if (password.length < 1 || password.length > 200) {
      return res.status(400).json({ message: 'Invalid password length' });
    }

    // Hash password (CWE-522)
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Use parameterized queries (CWE-89)
    db.run(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          // CWE-209: Don't expose internal error details
          return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    // CWE-703, CWE-209
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // CWE-307: Rate limiting
    const allowed = await checkRateLimit(email);
    if (!allowed) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }

    // Use parameterized queries (CWE-89)
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      try {
        if (err) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!user) {
          await recordLoginAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          await recordLoginAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Clear login attempts on successful login
        await clearLoginAttempts(email);

        // CWE-345: Include expiration in JWT token
        const token = jwt.sign(
          { userId: user.id, username: user.username, email: user.email },
          APP_SECRET,
          { algorithm: 'HS256', expiresIn: '1h' }
        );

        return res.status(200).json({ token, message: 'Login successful' });
      } catch (innerErr) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    });
  } catch (err) {
    // CWE-703, CWE-209
    return res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || secret === undefined || secret === null) {
      return res.status(400).json({ message: 'Username and secret are required' });
    }

    if (typeof username !== 'string' || typeof secret !== 'string') {
      return res.status(400).json({ message: 'Invalid data types' });
    }

    // CWE-863: Authorization check - ensure the authenticated user can only set their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Use parameterized queries (CWE-89)
    db.get('SELECT * FROM secrets WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'An error occurred' });
      }

      if (row) {
        db.run(
          'UPDATE secrets SET secret = ? WHERE username = ?',
          [secret, username],
          function (err) {
            if (err) {
              return res.status(500).json({ message: 'An error occurred' });
            }
            return res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      } else {
        db.run(
          'INSERT INTO secrets (username, secret) VALUES (?, ?)',
          [username, secret],
          function (err) {
            if (err) {
              return res.status(500).json({ message: 'An error occurred' });
            }
            return res.status(200).json({ message: 'Secret has been set successfully' });
          }
        );
      }
    });
  } catch (err) {
    // CWE-703, CWE-209
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    if (typeof username !== 'string') {
      return res.status(400).json({ message: 'Invalid data types' });
    }

    // CWE-863: Authorization check - ensure the authenticated user can only get their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Use parameterized queries (CWE-89)
    db.get('SELECT secret FROM secrets WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'An error occurred' });
      }

      if (!row) {
        return res.status(200).json({ secret: '' });
      }

      return res.status(200).json({ secret: row.secret });
    });
  } catch (err) {
    // CWE-703, CWE-209
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'An internal error occurred' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});