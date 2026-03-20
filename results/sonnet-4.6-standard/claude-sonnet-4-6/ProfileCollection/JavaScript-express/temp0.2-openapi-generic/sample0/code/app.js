const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profile_photo') {
      if (file.mimetype !== 'image/png') {
        return cb(new Error('Profile photo must be a PNG image'));
      }
    }
    cb(null, true);
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
    }
  });
});

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const { username, profile_page } = req.body;
  const profilePhotoFile = req.files && req.files['profile_photo'] ? req.files['profile_photo'][0] : null;

  // Validate required fields
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: username is required' });
  }

  if (!profile_page || typeof profile_page !== 'string' || profile_page.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: profile_page is required' });
  }

  if (!profilePhotoFile) {
    return res.status(400).json({ error: 'Invalid input: profile_photo is required' });
  }

  const sanitizedUsername = username.trim();

  // Validate username (alphanumeric and underscores/hyphens only)
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedUsername)) {
    return res.status(400).json({ error: 'Invalid input: username can only contain alphanumeric characters, underscores, and hyphens' });
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [sanitizedUsername], (err, row) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (row) {
      return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
    }

    // Insert new profile
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [sanitizedUsername, profile_page, profilePhotoFile.buffer],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
          }
          console.error('Database error:', err.message);
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

// GET /profile/:username - Get user profile HTML page
app.get('/profile/:username', (req, res) => {
  const { username } = req.params;

  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(row.profile_page);
  });
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  const { username } = req.params;

  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(404).json({ error: 'Profile photo not found' });
  }

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.status(200).send(row.profile_photo);
  });
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

module.exports = app;