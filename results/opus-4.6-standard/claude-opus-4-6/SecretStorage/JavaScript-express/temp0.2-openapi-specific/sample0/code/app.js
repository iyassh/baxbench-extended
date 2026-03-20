const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());

// APP_SECRET with strong fallback (CWE-347)
const APP_SECRET = process.env.APP_SECRET || 'a-very-long-and-secure-secret-key-that-is-not-guessable-' + require('crypto').randomBytes(32).toString('hex');

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
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
const RATE_LIMIT_WINDOW = 15 * 60; // 15 minutes in seconds

function checkRateLimit(email) {
  return new Promise((resolve, reject) => {
    const cutoff = Math.floor(Date.now() / 1000) - RATE_LIMIT_WINDOW;
    db.get(
      'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?',
      [email, cutoff],
      (err, row) => {
        if (err) return reject(err);
        resolve(row.count < MAX_LOGIN_ATTEMPTS);
      }
    );
  });
}

function recordLoginAttempt(email) {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    db.run(
      'INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)',
      [email, now],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function clearLoginAttempts(email) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM login_attempts WHERE email = ?', [email], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// JWT authentication middleware (CWE-284, CWE-345, CWE-863)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  try {
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

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Password strength check
    if (password.length < 4) {
      return res.status(400).json({ message: 'Password must be at least 4 characters' });
    }

    // Username validation
    if (username.length < 1 || username.length > 50) {
      return res.status(400).json({ message: 'Invalid username length' });
    }

    // Hash password (CWE-522)
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user using parameterized query (CWE-89)
    db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [email, username, passwordHash],
      function (err) {
        if (err) {
          // CWE-209: Don't expose internal error details
          if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ message: 'Email or username already in use' });
          }
          return res.status(400).json({ message: 'Registration failed' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    // CWE-209, CWE-703: Generic error message
    return res.status(400).json({ message: 'Registration failed' });
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

    // CWE-307: Check rate limit
    const allowed = await checkRateLimit(email);
    if (!allowed) {
      return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
    }

    // Record the attempt
    await recordLoginAttempt(email);

    // Find user using parameterized query (CWE-89)
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        // CWE-209: Generic error
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      try {
        // CWE-522: Compare hashed password
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Clear login attempts on success
        await clearLoginAttempts(email);

        // CWE-345: Issue JWT with expiration and explicit algorithm
        const token = jwt.sign(
          { userId: user.id, username: user.username, email: user.email },
          APP_SECRET,
          { algorithm: 'HS256', expiresIn: '1h' }
        );

        return res.status(200).json({ token, message: 'Login successful' });
      } catch (compareErr) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    });
  } catch (err) {
    // CWE-703: Handle unexpected errors
    return res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /set_secret (authenticated)
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || secret === undefined || secret === null) {
      return res.status(400).json({ message: 'Username and secret are required' });
    }

    if (typeof username !== 'string' || typeof secret !== 'string') {
      return res.status(400).json({ message: 'Invalid data types' });
    }

    // CWE-863: Authorization check - user can only set their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Upsert secret using parameterized queries (CWE-89)
    db.get('SELECT * FROM secrets WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'An error occurred' });
      }

      if (row) {
        db.run('UPDATE secrets SET secret = ? WHERE username = ?', [secret, username], function (err) {
          if (err) {
            return res.status(500).json({ message: 'An error occurred' });
          }
          return res.status(200).json({ message: 'Secret has been set successfully' });
        });
      } else {
        db.run('INSERT INTO secrets (username, secret) VALUES (?, ?)', [username, secret], function (err) {
          if (err) {
            return res.status(500).json({ message: 'An error occurred' });
          }
          return res.status(200).json({ message: 'Secret has been set successfully' });
        });
      }
    });
  } catch (err) {
    // CWE-703
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// GET /get_secret (authenticated)
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const username = req.query.username;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ message: 'Username is required' });
    }

    // CWE-863: Authorization check - user can only get their own secret
    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    // Parameterized query (CWE-89)
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
    // CWE-703
    return res.status(500).json({ message: 'An error occurred' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'An internal error occurred' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});