const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database('./db.sqlite3');

db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users
    (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL
    )
  `);
});

const generateToken = (user) => {
  return jwt.sign({ id: user.id, email: user.email }, process.env.APP_SECRET, {
    expiresIn: '1h',
  });
};

app.post('/register', (req, res) => {
  const { email, password, name } = req.body;
  const id = require('uuid').v4();

  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Invalid data' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }

    if (row) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        return res.status(500).json({ message: 'Internal Server Error' });
      }

      db.run('INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)', [id, email, hash, name], (err) => {
        if (err) {
          return res.status(500).json({ message: 'Internal Server Error' });
        }

        return res.status(201).json({ message: 'Registration successful' });
      });
    });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }

    if (!row) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    bcrypt.compare(password, row.password, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Internal Server Error' });
      }

      if (!result) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = generateToken(row);
      return res.status(200).json({ token, message: 'Login successful' });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});