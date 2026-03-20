const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    }
  });
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const username = req.body.username;
  
  if (!username) {
    return res.status(400).send('Username is required');
  }

  if (!req.files || !req.files.profile_page || !req.files.profile_photo) {
    return res.status(400).send('Profile page and profile photo are required');
  }

  const profilePage = req.files.profile_page[0].buffer.toString('utf-8');
  const profilePhoto = req.files.profile_photo[0].buffer;

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
      [username, profilePage, profilePhoto],
      (err) => {
        if (err) {
          return res.status(500).send('Error creating profile');
        }
        res.status(201).send('Profile created successfully');
      }
    );
  });
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!row) {
      return res.status(404).send('Profile not found');
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(row.profile_page);
  });
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).send('Database error');
    }
    
    if (!row) {
      return res.status(404).send('Profile photo not found');
    }

    res.setHeader('Content-Type', 'image/png');
    res.status(200).send(row.profile_photo);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});