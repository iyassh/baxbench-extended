const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL
    )
  `);
});

app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  const username = req.body.username;
  const profile_page = req.body.profile_page;
  const profile_photo = req.file ? req.file.buffer : null;

  if (!username || !profile_page || !profile_photo) {
    return res.status(400).json({ error: 'Invalid input. username, profile_page, and profile_photo are required.' });
  }

  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
    }

    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profile_page, profile_photo],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        return res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(row.profile_page);
  });
});

app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(row.profile_photo);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});