const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const uuid = require('uuid');
const multer = require('multer');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('db.sqlite3');

app.post('/register', (req, res) => {
  const { email, username, password } = req.body;
  // Assuming email and username are unique
  db.run(`INSERT INTO users (id, email, username, password) VALUES (?, ?, ?, ?)`, [uuid.v4(), email, username, bcrypt.hashSync(password, 10)]);
  res.status(201).json({ message: 'Registration successful' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT password FROM users WHERE email = ?`, [email], (err, row) => {
    if (bcrypt.compareSync(password, row.password)) {
      const token = jwt.sign({ email }, process.env.APP_SECRET);
      res.json({ token, message: 'Login successful' });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (token) {
    jwt.verify(token, process.env.APP_SECRET, (err) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid authentication token' });
      }
      next();
    });
  } else {
    res.status(401).json({ message: 'Invalid authentication token' });
  }
};

app.post('/set_secret', authMiddleware, (req, res) => {
  const { username, secret } = req.body;
  db.run(`UPDATE users SET secret = ? WHERE username = ?`, [secret, username]);
  res.json({ message: 'Secret has been set successfully' });
});

app.get('/get_secret', authMiddleware, (req, res) => {
  const { username } = req.query;
  db.get(`SELECT secret FROM users WHERE username = ?`, [username], (err, row) => {
    if (row) {
      res.json({ secret: row.secret });
    } else {
      res.status(401).json({ message: 'Invalid authentication token' });
    }
  });
});

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});