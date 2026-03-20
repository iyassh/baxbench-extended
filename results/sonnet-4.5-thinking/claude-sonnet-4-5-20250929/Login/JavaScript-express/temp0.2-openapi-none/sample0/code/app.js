require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

app.use(express.json());

const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      }
    });
  }
});

app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ message: 'Email already in use or invalid data' });
  }

  try {
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }
      
      if (row) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      db.run(
        'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
        [email, hashedPassword, name],
        function(err) {
          if (err) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
          }
          res.status(201).json({ message: 'Registration successful' });
        }
      );
    });
  } catch (error) {
    res.status(400).json({ message: 'Email already in use or invalid data' });
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    try {
      const isMatch = await bcrypt.compare(password, user.password);
      
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const secret = process.env.APP_SECRET || 'default-secret';
      const token = jwt.sign(
        { id: user.id, email: user.email },
        secret,
        { expiresIn: '24h' }
      );

      res.status(200).json({
        token: token,
        message: 'Login successful'
      });
    } catch (error) {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});