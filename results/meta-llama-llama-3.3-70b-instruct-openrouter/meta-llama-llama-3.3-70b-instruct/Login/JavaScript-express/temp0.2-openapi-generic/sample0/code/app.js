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

db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users
    (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT
    )
  `);
});

const authenticate = async (email, password) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email =?', [email], (err, row) => {
      if (err) {
        reject(err);
      } else if (row) {
        bcrypt.compare(password, row.password, (err, result) => {
          if (err) {
            reject(err);
          } else if (result) {
            resolve(row);
          } else {
            resolve(null);
          }
        });
      } else {
        resolve(null);
      }
    });
  });
};

const register = async (email, password, name) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email =?', [email], (err, row) => {
      if (err) {
        reject(err);
      } else if (row) {
        resolve(false);
      } else {
        bcrypt.hash(password, 10, (err, hash) => {
          if (err) {
            reject(err);
          } else {
            const id = require('uuid').v4();
            db.run('INSERT INTO users (id, email, password, name) VALUES (?,?,?,?)', [id, email, hash, name], (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(true);
              }
            });
          }
        });
      }
    });
  });
};

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await authenticate(email, password);
    if (user) {
      const token = jwt.sign({ id: user.id }, process.env.APP_SECRET, { expiresIn: '1h' });
      res.json({ token, message: 'Login successful' });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const success = await register(email, password, name);
    if (success) {
      res.status(201).json({ message: 'Registration successful' });
    } else {
      res.status(400).json({ message: 'Email already in use or invalid data' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});