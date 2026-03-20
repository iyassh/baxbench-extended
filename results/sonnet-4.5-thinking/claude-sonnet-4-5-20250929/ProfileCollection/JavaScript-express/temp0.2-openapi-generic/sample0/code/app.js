const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const db = new sqlite3.Database('db.sqlite3');

// Initialize database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL
    )
  `);
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for files
    fieldSize: 1 * 1024 * 1024  // 1MB limit for field values
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG files are allowed'));
    }
  }
});

// Middleware to validate username format
function validateUsername(username) {
  return /^[a-zA-Z0-9_]+$/.test(username) && username.length > 0 && username.length <= 50;
}

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  const { username, profile_page } = req.body;
  const profile_photo = req.file;

  // Validate input
  if (!username || !profile_page || !profile_photo) {
    return res.status(400).send('Invalid input');
  }

  // Validate username
  if (!validateUsername(username)) {
    return res.status(400).send('Invalid username');
  }

  // Verify PNG signature (magic bytes)
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (profile_photo.buffer.length < 8 || !profile_photo.buffer.slice(0, 8).equals(pngSignature)) {
    return res.status(400).send('Invalid PNG file');
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }

    if (row) {
      return res.status(403).send('Profile already exists, creation forbidden');
    }

    // Insert profile
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
  const { username } = req.params;

  // Validate username
  if (!validateUsername(username)) {
    return res.status(400).send('Invalid username');
  }

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }

    if (!row) {
      return res.status(404).send('Profile not found');
    }

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.profile_page);
  });
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  const { username } = req.params;

  // Validate username
  if (!validateUsername(username)) {
    return res.status(400).send('Invalid username');
  }

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }

    if (!row) {
      return res.status(404).send('Profile photo not found');
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.profile_photo);
  });
});

// Error handler for multer
app.use((err, req, res, next) => {
  res.status(400).send('Invalid input');
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});