const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create tables
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
      console.error('Error creating profiles table:', err);
    }
  });
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profile_photo') {
      if (file.mimetype === 'image/png') {
        cb(null, true);
      } else {
        cb(new Error('Profile photo must be PNG format'));
      }
    } else if (file.fieldname === 'profile_page') {
      cb(null, true);
    } else {
      cb(new Error('Invalid field name'));
    }
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Validation helper
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return false;
  }
  // Allow alphanumeric, underscore, hyphen
  return /^[a-zA-Z0-9_-]{1,50}$/.test(username);
}

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  try {
    const { username } = req.body;

    // Validate username
    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }

    // Check if files are provided
    if (!req.files || !req.files.profile_page || !req.files.profile_photo) {
      return res.status(400).json({ error: 'Both profile_page and profile_photo are required' });
    }

    const profilePage = req.files.profile_page[0].buffer.toString('utf-8');
    const profilePhoto = req.files.profile_photo[0].buffer;

    // Validate HTML content is not too large
    if (profilePage.length > 1024 * 1024) {
      return res.status(400).json({ error: 'Profile page content too large' });
    }

    // Insert into database
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profilePage, profilePhoto],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(403).json({ error: 'Profile already exists' });
          }
          console.error('Database error:', err);
          return res.status(400).json({ error: 'Failed to create profile' });
        }
        res.status(201).json({ message: 'Profile created successfully', username });
      }
    );
  } catch (err) {
    console.error('Error in /add_profile:', err);
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
  try {
    const { username } = req.params;

    // Validate username
    if (!validateUsername(username)) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    db.get(
      'SELECT profile_page FROM profiles WHERE username = ?',
      [username],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
          return res.status(404).json({ error: 'Profile not found' });
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(row.profile_page);
      }
    );
  } catch (err) {
    console.error('Error in /profile/:username:', err);
    res.status(404).json({ error: 'Profile not found' });
  }
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  try {
    const { username } = req.params;

    // Validate username
    if (!validateUsername(username)) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    db.get(
      'SELECT profile_photo FROM profiles WHERE username = ?',
      [username],
      (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!row || !row.profile_photo) {
          return res.status(404).json({ error: 'Profile photo not found' });
        }

        res.setHeader('Content-Type', 'image/png');
        res.status(200).send(row.profile_photo);
      }
    );
  } catch (err) {
    console.error('Error in /profile-photo/:username:', err);
    res.status(404).json({ error: 'Profile photo not found' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    }
    console.log('Database connection closed');
    process.exit(0);
  });
});