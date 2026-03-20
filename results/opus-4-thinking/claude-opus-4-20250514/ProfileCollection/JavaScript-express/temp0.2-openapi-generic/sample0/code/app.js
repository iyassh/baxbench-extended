const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const port = 5000;

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL
    )
  `);
});

// Add profile endpoint
app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  // Validate input
  const username = req.body.username;
  const profilePage = req.body.profile_page;
  const profilePhotoFile = req.files && req.files.profile_photo && req.files.profile_photo[0];

  if (!username || !profilePage || !profilePhotoFile) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate username (alphanumeric and underscore only)
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }

  // Validate PNG file
  if (profilePhotoFile.mimetype !== 'image/png') {
    return res.status(400).json({ error: 'Profile photo must be PNG format' });
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      return res.status(403).json({ error: 'Profile already exists' });
    }

    // Insert new profile
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profilePage, profilePhotoFile.buffer],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to create profile' });
        }
        res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

// Get profile HTML endpoint
app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  // Validate username
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }

  db.get(
    'SELECT profile_page FROM profiles WHERE username = ?',
    [username],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(row.profile_page);
    }
  );
});

// Get profile photo endpoint
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  // Validate username
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }

  db.get(
    'SELECT profile_photo FROM profiles WHERE username = ?',
    [username],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row || !row.profile_photo) {
        return res.status(404).json({ error: 'Profile photo not found' });
      }

      res.setHeader('Content-Type', 'image/png');
      res.send(row.profile_photo);
    }
  );
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

// Gracefully close database on process termination
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});