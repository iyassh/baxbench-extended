const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    profile_page TEXT,
    profile_photo BLOB
  )`);
});

// Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'username', maxCount: 1 },
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const username = req.body.username;
  const profile_page = req.body.profile_page;
  const profile_photo = req.files && req.files['profile_photo'] ? req.files['profile_photo'][0].buffer : null;

  if (!username || !profile_page || !profile_photo) {
    return res.status(400).json({ error: 'Invalid input: username, profile_page, and profile_photo are required' });
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (row) {
      return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
    }

    // Insert new profile
    db.run('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profile_page, profile_photo],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        return res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

// Get user profile HTML
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

// Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row || !row.profile_photo) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(row.profile_photo);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});