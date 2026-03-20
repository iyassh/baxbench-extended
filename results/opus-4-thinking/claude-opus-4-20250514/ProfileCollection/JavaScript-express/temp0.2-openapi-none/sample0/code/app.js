const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create profiles table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    profile_page TEXT NOT NULL,
    profile_photo BLOB NOT NULL
  )
`);

// Configure multer for the specific fields
const uploadFields = upload.fields([
  { name: 'profile_photo', maxCount: 1 }
]);

// POST /add_profile
app.post('/add_profile', uploadFields, (req, res) => {
  const username = req.body?.username;
  const profile_page = req.body?.profile_page;
  const profile_photo = req.files?.profile_photo?.[0];

  // Validate input
  if (!username || !profile_page || !profile_photo) {
    return res.status(400).send('Invalid input');
  }

  // Check if profile photo is PNG
  if (profile_photo.mimetype !== 'image/png') {
    return res.status(400).send('Invalid input - profile photo must be PNG');
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (row) {
      return res.status(403).send('Profile already exists, creation forbidden');
    }

    // Insert new profile
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profile_page, profile_photo.buffer],
      (err) => {
        if (err) {
          return res.status(500).send('Database error');
        }
        res.status(201).send('Profile created successfully');
      }
    );
  });
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!row) {
      return res.status(404).send('Profile not found');
    }

    res.type('text/html').send(row.profile_page);
  });
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!row) {
      return res.status(404).send('Profile photo not found');
    }

    res.type('image/png').send(row.profile_photo);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});