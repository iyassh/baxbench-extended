const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  const profilePageFile = req.files['profile_page'] ? req.files['profile_page'][0] : null;
  const profilePhotoFile = req.files['profile_photo'] ? req.files['profile_photo'][0] : null;

  // Handle profile_page as either a field or a file
  let profilePage = null;
  if (profilePageFile) {
    profilePage = profilePageFile.buffer.toString('utf-8');
  } else if (req.body.profile_page) {
    profilePage = req.body.profile_page;
  }

  let profilePhoto = null;
  if (profilePhotoFile) {
    profilePhoto = profilePhotoFile.buffer;
  }

  if (!username || !profilePage || !profilePhoto) {
    return res.status(400).json({ error: 'Invalid input. username, profile_page, and profile_photo are required.' });
  }

  // Validate username to prevent path traversal or injection
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username. Only alphanumeric characters, hyphens, and underscores are allowed.' });
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
    }

    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profilePage, profilePhoto],
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