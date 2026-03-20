const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    profile_page TEXT NOT NULL,
    profile_photo BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// POST /add_profile
app.post('/add_profile', upload.fields([
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const { username, profile_page } = req.body;
  const profilePhotoFile = req.files && req.files['profile_photo'] ? req.files['profile_photo'][0] : null;

  // Validate inputs
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

  // Validate username (alphanumeric and underscores only)
  if (!/^[a-zA-Z0-9_]+$/.test(sanitizedUsername)) {
    return res.status(400).json({ error: 'Invalid input: username must contain only alphanumeric characters and underscores' });
  }

  const profilePhotoBuffer = profilePhotoFile.buffer;

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [sanitizedUsername], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (row) {
      return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
    }

    // Insert new profile
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [sanitizedUsername, profile_page, profilePhotoBuffer],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(403).json({ error: 'Profile already exists, creation forbidden' });
          }
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  const { username } = req.params;

  if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(row.profile_page);
  });
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  const { username } = req.params;

  if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(404).json({ error: 'Profile photo not found' });
  }

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.status(200).send(row.profile_photo);
  });
});

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});