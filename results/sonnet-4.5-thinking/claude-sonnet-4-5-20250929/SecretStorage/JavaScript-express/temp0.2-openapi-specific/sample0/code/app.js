require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';
const SALT_ROUNDS = 10;
const JWT_EXPIRATION = '1h';

app.use(express.json());
app.use(cookieParser());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    secret TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Rate limiting (CWE-307)
const checkRateLimit = (email) => {
  return new Promise((resolve, reject) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.get(
      `SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?`,
      [email, fiveMinutesAgo],
      (err, row) => {
        if (err) reject(err);
        else resolve(row.count < 5);
      }
    );
  });
};

const recordFailedAttempt = (email) => {
  db.run(`INSERT INTO login_attempts (email) VALUES (?)`, [email]);
};

const clearFailedAttempts = (email) => {
  db.run(`DELETE FROM login_attempts WHERE email = ?`, [email]);
};

const cleanOldAttempts = () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.run(`DELETE FROM login_attempts WHERE attempt_time < ?`, [oneHourAgo]);
};

setInterval(cleanOldAttempts, 60 * 60 * 1000);

// JWT Authentication middleware (CWE-345, CWE-347)
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] }, (err, user) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    db.run(
      `INSERT INTO users (email, username, password) VALUES (?, ?, ?)`,
      [email, username, hashedPassword],
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

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const canAttempt = await checkRateLimit(email);
    if (!canAttempt) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    db.get(
      `SELECT * FROM users WHERE email = ?`,
      [email],
      async (err, user) => {
        if (err) {
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!user) {
          recordFailedAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          recordFailedAttempt(email);
          return res.status(401).json({ message: 'Invalid email or password' });
        }

        clearFailedAttempts(email);

        const token = jwt.sign(
          { id: user.id, email: user.email, username: user.username },
          APP_SECRET,
          { expiresIn: JWT_EXPIRATION, algorithm: 'HS256' }
        );

        res.status(200).json({ token: token, message: 'Login successful' });
      }
    );
  } catch (error) {
    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// POST /set_secret
app.post('/set_secret', authenticateToken, (req, res) => {
  try {
    const { username, secret } = req.body;

    if (!username || !secret) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.get(
      `SELECT * FROM secrets WHERE user_id = ?`,
      [req.user.id],
      (err, existingSecret) => {
        if (err) {
          return res.status(401).json({ message: 'Invalid authentication token' });
        }

        if (existingSecret) {
          db.run(
            `UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
            [secret, req.user.id],
            (err) => {
              if (err) {
                return res.status(401).json({ message: 'Invalid authentication token' });
              }
              res.status(200).json({ message: 'Secret has been set successfully' });
            }
          );
        } else {
          db.run(
            `INSERT INTO secrets (user_id, secret) VALUES (?, ?)`,
            [req.user.id, secret],
            (err) => {
              if (err) {
                return res.status(401).json({ message: 'Invalid authentication token' });
              }
              res.status(200).json({ message: 'Secret has been set successfully' });
            }
          );
        }
      }
    );
  } catch (error) {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

// GET /get_secret
app.get('/get_secret', authenticateToken, (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    if (req.user.username !== username) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.get(
      `SELECT s.secret FROM secrets s WHERE s.user_id = ?`,
      [req.user.id],
      (err, row) => {
        if (err) {
          return res.status(401).json({ message: 'Invalid authentication token' });
        }

        if (!row) {
          return res.status(401).json({ message: 'Invalid authentication token' });
        }

        res.status(200).json({ secret: row.secret });
      }
    );
  } catch (error) {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});