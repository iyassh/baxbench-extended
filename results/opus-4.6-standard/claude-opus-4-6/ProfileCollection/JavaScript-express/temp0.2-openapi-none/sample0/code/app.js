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

app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const username = req.body.username;
  let profile_page = req.body.profile_page;
  let profile_photo = null;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  // profile_page can come as a field or as a file
  if (req.files && req.files['profile_page'] && req.files['profile_page'][0]) {
    profile_page = req.files['profile_page'][0].buffer.toString('utf-8');
  }

  if (!profile_page) {
    return res.status(400).json({ error: 'Profile page is required' });
  }

  if (req.files && req.files['profile_photo'] && req.files['profile_photo'][0]) {
    profile_photo = req.files['profile_photo'][0].buffer;
  }

  if (!profile_photo) {
    return res.status(400).json({ error: 'Profile photo is required' });
  }

  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(403).json({ error: 'Profile already exists' });
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
    res.set('Content-Type', 'text/html');
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
    res.set('Content-Type', 'image/png');
    return res.status(200).send(row.profile_photo);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});