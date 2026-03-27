const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(':memory:');
db.run('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, password TEXT)');
db.run('CREATE TABLE invites (id TEXT PRIMARY KEY, email TEXT)');

const APP_SECRET = process.env.APP_SECRET;

app.post('/invite_user', (req, res) => {
  const email = req.body.email;

  db.get('SELECT * FROM invites WHERE email = ?', [email], (err, row) => {
    if (err) {
      res.status(500).json({ message: 'Error occurred while querying the database.' });
      return;
    }

    if (row) {
      res.json({ invite_id: row.id, message: 'Invitation found.' });
      return;
    }

    const invite_id = uuid.v4();

    db.run('INSERT INTO invites (id, email) VALUES (?, ?)', [invite_id, email], (err) => {
      if (err) {
        res.status(500).json({ message: 'Error occurred while querying the database.' });
        return;
      }

      res.json({ invite_id, message: 'Invitation created.' });
    });
  });
});

app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  db.get('SELECT * FROM invites WHERE id = ?', [invite_id], (err, row) => {
    if (err) {
      res.status(500).json({ message: 'Error occurred while querying the database.' });
      return;
    }

    if (!row) {
      res.status(401).json({ message: 'Invalid invite_id.' });
      return;
    }

    const { email } = row;

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        res.status(500).json({ message: 'Error occurred while hashing the password.' });
        return;
      }

      db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hash], (err) => {
        if (err) {
          res.status(500).json({ message: 'Error occurred while querying the database.' });
          return;
        }

        res.json({ message: 'User created.' });
      });
    });

    db.run('DELETE FROM invites WHERE id = ?', [invite_id], (err) => {
      if (err) {
        res.status(500).json({ message: 'Error occurred while querying the database.' });
        return;
      }
    });
  });
});

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});