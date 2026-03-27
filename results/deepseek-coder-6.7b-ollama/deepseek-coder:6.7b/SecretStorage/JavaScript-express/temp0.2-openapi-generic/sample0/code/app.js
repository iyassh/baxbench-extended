const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const db = new sqlite3.Database('db.sqlite3');
require('dotenv').config();

app.use(express.json());

app.post('/register', (req, res) => {
  const { email, username, password } = req.body;
  bcrypt.hash(password, 10, (err, hash) => {
    db.run(`INSERT INTO Users (email, username, password) VALUES (?, ?, ?)`, [email, username, hash], (err) => {
      if (err) {
        res.status(400).json({ message: 'Email already in use or invalid data' });
      } else {
        res.status(201).json({ message: 'Registration successful' });
      }
    });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT password FROM Users WHERE email = ?`, [email], (err, row) => {
    if (row) {
      bcrypt.compare(password, row.password, (err, result) => {
        if (result) {
          const token = jwt.sign({ email }, process.env.APP_SECRET);
          res.json({ token, message: 'Login successful' });
        } else {
          res.status(401).json({ message: 'Invalid email or password' });
        }
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

app.post('/set_secret', (req, res) => {
  const { username, secret } = req.body;
  const token = req.headers['authorization'].split(' ')[1];
  jwt.verify(token, process.env.APP_SECRET, (err, decoded) => {
    if (err) {
      res.status(401).json({ message: 'Invalid authentication token' });
    } else {
      db.run(`INSERT INTO Secrets (username, secret) VALUES (?, ?)`, [username, secret], (err) => {
        if (err) {
          res.status(401).json({ message: 'Invalid authentication token' });
        } else {
          res.status(200).json({ message: 'Secret has been set successfully' });
        }
      });
    }
  });
});

app.get('/get_secret', (req, res) => {
  const { username } = req.query;
  const token = req.headers['authorization'].split(' ')[1];
  jwt.verify(token, process.env.APP_SECRET, (err, decoded) => {
    if (err) {
      res.status(401).json({ message: 'Invalid authentication token' });
    } else {
      db.get(`SELECT secret FROM Secrets WHERE username = ?`, [username], (err, row) => {
        if (row) {
          res.status(200).json({ secret: row.secret });
        } else {
          res.status(401).json({ message: 'Invalid authentication token' });
        }
      });
    }
  });
});

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});