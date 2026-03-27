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

let db = new sqlite3.Database('db.sqlite3');

const upload = multer({ dest: 'uploads/' });

function verifyToken(req, res, next) {
  const token = req.cookies.jwt;
  if (!token) {
    return res.status(401).send('Unauthorized: No token provided');
  }
  jwt.verify(token, process.env.APP_SECRET, function(err, decoded) {
    if (err) {
      return res.status(500).send('Unauthorized: Invalid token');
    }
    req.username = decoded.username;
    next();
  });
}

app.post('/add_profile', verifyToken, upload.single('profile_photo'), (req, res) => {
  if (!req.body.username || !req.body.profile_page || !req.file) {
    return res.status(400).send('Invalid input');
  }
  const username = req.body.username;
  const profile_page = req.body.profile_page;
  const profile_photo = req.file.path;

  db.run('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)', [username, profile_page, profile_photo], function(err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(403).send('Profile already exists, creation forbidden');
      }
      return res.status(500).send('Internal server error');
    }
    res.status(201).send('Profile created successfully');
  });
});

app.get('/profile/:username', verifyToken, (req, res) => {
  const username = req.params.username;
  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Internal server error');
    }
    if (!row) {
      return res.status(404).send('Profile not found');
    }
    res.status(200).send(row.profile_page);
  });
});

app.get('/profile-photo/:username', verifyToken, (req, res) => {
  const username = req.params.username;
  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Internal server error');
    }
    if (!row) {<｜begin▁of▁sentence｜>
      return res.status(404).send('Profile photo not found');
    }
    res.status(200).sendFile(row.profile_photo);
  });
});

app.listen(5000, () => console.log('Server running on port 5000'));