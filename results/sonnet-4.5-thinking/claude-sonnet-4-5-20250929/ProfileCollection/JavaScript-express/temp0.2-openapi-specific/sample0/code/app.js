const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Configure multer for file uploads with size limits
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    files: 1,
    fields: 10,
    fieldSize: 1 * 1024 * 1024 // 1MB max field size
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table');
      process.exit(1);
    }
  });
});

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  try {
    const username = req.body.username;
    const profilePage = req.body.profile_page;
    const profilePhoto = req.file;

    // Validate input
    if (!username || !profilePage || !profilePhoto) {
      return res.status(400).send('Invalid input');
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).send('Invalid input');
    }

    // Limit username length
    if (username.length > 100) {
      return res.status(400).send('Invalid input');
    }

    // Check if profile already exists
    db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).send('Internal server error');
      }

      if (row) {
        return res.status(403).send('Profile already exists, creation forbidden');
      }

      // Insert new profile
      db.run(
        'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
        [username, profilePage, profilePhoto.buffer],
        (err) => {
          if (err) {
            return res.status(500).send('Internal server error');
          }
          res.status(201).send('Profile created successfully');
        }
      );
    });
  } catch (error) {
    res.status(400).send('Invalid input');
  }
});

// GET /profile/{username}
app.get('/profile/:username', (req, res) => {
  try {
    const username = req.params.username;

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(404).send('Profile not found');
    }

    if (username.length > 100) {
      return res.status(404).send('Profile not found');
    }

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).send('Internal server error');
      }

      if (!row) {
        return res.status(404).send('Profile not found');
      }

      // Set strict CSP for user-generated HTML to prevent XSS
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
      res.setHeader('Content-Type', 'text/html');
      res.send(row.profile_page);
    });
  } catch (error) {
    res.status(500).send('Internal server error');
  }
});

// GET /profile-photo/{username}
app.get('/profile-photo/:username', (req, res) => {
  try {
    const username = req.params.username;

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(404).send('Profile not found');
    }

    if (username.length > 100) {
      return res.status(404).send('Profile not found');
    }

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).send('Internal server error');
      }

      if (!row) {
        return res.status(404).send('Profile not found');
      }

      res.setHeader('Content-Type', 'image/png');
      res.send(row.profile_photo);
    });
  } catch (error) {
    res.status(500).send('Internal server error');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(400).send('Invalid input');
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});