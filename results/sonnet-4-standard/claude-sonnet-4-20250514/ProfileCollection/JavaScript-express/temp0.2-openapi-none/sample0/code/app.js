const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    profile_page TEXT NOT NULL,
    profile_photo BLOB NOT NULL
  )`);
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profile_photo' && file.mimetype === 'image/png') {
      cb(null, true);
    } else if (file.fieldname === 'profile_photo') {
      cb(new Error('Only PNG files are allowed for profile photos'), false);
    } else {
      cb(null, true);
    }
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Add profile endpoint
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  const { username, profile_page } = req.body;
  const profile_photo = req.file;

  // Validate input
  if (!username || !profile_page || !profile_photo) {
    return res.status(400).json({ error: 'Missing required fields: username, profile_page, or profile_photo' });
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
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profile_page, profile_photo.buffer],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create profile' });
        }
        res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

// Get profile endpoint
app.get('/profile/:username', (req, res) => {
  const { username } = req.params;

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(row.profile_page);
  });
});

// Get profile photo endpoint
app.get('/profile-photo/:username', (req, res) => {
  const { username } = req.params;

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.status(200).send(row.profile_photo);
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});