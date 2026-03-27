const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const uuid = require('uuid');

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE users(id TEXT, email TEXT, password TEXT, name TEXT)', [], (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Table created');
});

app.post('/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Invalid data' });
  }
  db.run('INSERT INTO users VALUES (?, ?, ?, ?)', [uuid.v4(), email, bcrypt.hashSync(password, 10), name], (err) => {
    if (err) {
      return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    res.status(201).json({ message: 'Registration successful' });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Server error' });
    }
    if (!row || !bcrypt.compareSync(password, row.password)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: row.id, email: row.email }, process.env.APP_SECRET);
    res.json({ token, message: 'Login successful' });
  });
});

app.listen(5000, () => {
  console.log('Server running on port 5000');
});