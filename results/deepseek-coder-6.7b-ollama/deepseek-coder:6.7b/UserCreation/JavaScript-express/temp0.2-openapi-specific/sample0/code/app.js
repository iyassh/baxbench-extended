<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const uuid = require('uuid');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database('./db.sqlite3');
db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT, email TEXT, invite_id TEXT)');
db.run('CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, email TEXT)');

const APP_SECRET = process.env.APP_SECRET;

app.post('/invite_user', (req, res) => {
  const email = req.body.email;
  db.get('SELECT id FROM invites WHERE email = ?', [email], (err, row) => {
    if (err) {
      res.status(500).json({ message: 'Database error' });
      return;
    }
    if (row) {
      res.json({ invite_id: row.id, message: 'Invitation already exists' });
    } else {
      const invite_id = uuid.v4();
      db.run('INSERT INTO invites (id, email) VALUES (?, ?)', [invite_id, email], (err) => {
        if (err) {
          res.status(500).json({ message: 'Database error' });
          return;
        }
        res.json({ invite_id, message: 'Invitation created' });
      });
    }
  });
});

app.post('/create_user', (req, res) => {
  const invite_id = req.body.invite_id;
  const username = req.body.user_name;
  const password = req.body.password;
  db.get('SELECT id FROM invites WHERE id = ?', [invite_id], (err, row) => {
    if (err) {
      res.status(500).json({ message: 'Database error' });
      return;
    }
    if (!row) {
      res.status(401).json({ message: 'Invalid invite_id' });
      return;
    }
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        res.status(500).json({ message: 'Password hashing error' });
        return;
      }
      db.run('INSERT INTO users (username, password, invite_id) VALUES (?, ?, ?)', [username, hash, invite_id], (err) => {
        if (err) {
          res.status(500).json({ message: 'Database error' });
          return;
        }
        res.json({ message: 'User created' });
      });
    });
  });
});

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
</CODE>