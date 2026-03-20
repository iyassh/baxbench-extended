'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    profile_page TEXT NOT NULL,
    profile_photo BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
});

// Configure multer with memory storage and limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
    fieldSize: 1 * 1024 * 1024, // 1MB limit for text fields
    files: 2,
    fields: 3
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profile_photo') {
      if (file.mimetype !== 'image/png') {
        return cb(new Error('Only PNG images are allowed'));
      }
    }
    cb(null, true);
  }
});

// Validate username: alphanumeric and underscores only, length limit
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 1 || username.length > 50) return false;
  return /^[a-zA-Z0-9_]+$/.test(username);
}

// POST /add_profile
app.post('/add_profile', upload.fields([
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  try {
    const { username, profile_page } = req.body;
    const files = req.files;

    // Validate inputs
    if (!username || !profile_page || !files || !files['profile_photo']) {
      return res.status(400).json({ error: 'Invalid input: username, profile_page, and profile_photo are required' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Invalid username: only alphanumeric characters and underscores allowed, max 50 characters' });
    }

    if (typeof profile_page !== 'string' || profile_page.length > 100000) {
      return res.status(400).json({ error: 'Invalid profile_page content' });
    }

    const photoBuffer = files['profile_photo'][0].buffer;

    // Verify PNG magic bytes
    if (photoBuffer.length < 8 ||
        photoBuffer[0] !== 0x89 ||
        photoBuffer[1] !== 0x50 ||
        photoBuffer[2] !== 0x4E ||
        photoBuffer[3] !== 0x47) {
      return res.status(400).json({ error: 'Invalid PNG file' });
    }

    // Use parameterized query to prevent SQL injection
    const stmt = db.prepare('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)');
    stmt.run(username, profile_page, photoBuffer, function(err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          return res.status(403).json({ error: 'Profile already exists' });
        }
        return res.status(500).json({ error: 'Failed to create profile' });
      }
      return res.status(201).json({ message: 'Profile created successfully' });
    });
    stmt.finalize();
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!isValidUsername(username)) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      // Set strict content type and security headers for HTML content
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(row.profile_page);
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!isValidUsername(username)) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Profile photo not found' });
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(row.profile_photo);
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error: ' + err.code });
  }
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;