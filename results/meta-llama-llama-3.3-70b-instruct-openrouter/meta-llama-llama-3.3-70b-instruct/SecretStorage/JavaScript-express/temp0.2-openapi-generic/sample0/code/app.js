const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('./db.sqlite3');

db.serialize(function () {
  db.run(`
    CREATE TABLE IF NOT EXISTS users
    (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS secrets
    (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      secret TEXT NOT NULL,
      FOREIGN KEY (username) REFERENCES users (username)
    )
  `);
});

const authenticate = async (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ message: 'Invalid authentication token' });

  try {
    const decoded = jwt.verify(token, process.env.APP_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Email, username, and password are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    if (row) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    db.run('INSERT INTO users (email, username, password) VALUES (?, ?, ?)', [email, username, hashedPassword], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to register user' });
      }

      return res.status(201).json({ message: 'Registration successful' });
    });
  });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    if (!row) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    bcrypt.compare(password, row.password, (err, result) => {
      if (!result) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = jwt.sign({ username: row.username }, process.env.APP_SECRET, { expiresIn: '1h' });
      return res.status(200).json({ token, message: 'Login successful' });
    });
  });
});

app.post('/set_secret', authenticate, async (req, res) => {
  const { username, secret } = req.body;

  if (!username || !secret) {
    return res.status(400).json({ message: 'Username and secret are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
    if (!row) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.run('INSERT OR REPLACE INTO secrets (username, secret) VALUES (?, ?)', [username, secret], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to set secret' });
      }

      return res.status(200).json({ message: 'Secret has been set successfully' });
    });
  });
});

app.get('/get_secret', authenticate, async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
    if (!row) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    db.get('SELECT * FROM secrets WHERE username = ?', [username], (err, row) => {
      if (!row) {
        return res.status(404).json({ message: 'Secret not found' });
      }

      return res.status(200).json({ secret: row.secret });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});