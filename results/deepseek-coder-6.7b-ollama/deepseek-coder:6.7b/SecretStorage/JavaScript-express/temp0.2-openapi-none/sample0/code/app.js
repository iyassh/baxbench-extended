const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(':memory:');

db.run('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, username TEXT, password TEXT)');
db.run('CREATE TABLE secrets (id TEXT PRIMARY KEY, userId TEXT, secret TEXT)');

const APP_SECRET = process.env.APP_SECRET;

app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ message: 'Invalid data' });
  }

  const userExists = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
      if (err) reject(err);
      resolve(!!row);
    });
  });

  if (userExists) {
    return res.status(400).json({ message: 'Email already in use' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();

  await new Promise((resolve, reject) => {
    db.run('INSERT INTO users (id, email, username, password) VALUES (?, ?, ?, ?)', [id, email, username, hashedPassword], (err) => {
      if (err) reject(err);
      resolve();
    });
  });

  return res.status(201).json({ message: 'Registration successful' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
      if (err) reject(err);
      resolve(row);
    });
  });

  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const passwordsMatch = await bcrypt.compare(password, user.password);

  if (!passwordsMatch) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id }, APP_SECRET);

  return res.status(200).json({ token, message: 'Login successful' });
});

app.post('/set_secret', multer().none(), (req, res) => {});

app.get('/get_secret', (req, res) => {});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server started on port 5000');
});