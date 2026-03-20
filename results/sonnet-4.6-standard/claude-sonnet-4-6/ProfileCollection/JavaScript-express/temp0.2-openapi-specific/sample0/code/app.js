'use strict';

const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
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
  )`);
});

// Configure multer with memory storage and file size limits
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
        return cb(new Error('Profile photo must be a PNG image'));
      }
    }
    cb(null, true);
  }
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Validate username: only allow alphanumeric and underscores, max length
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 1 || username.length > 50) return false;
  return /^[a-zA-Z0-9_]+$/.test(username);
}

// Sanitize HTML to prevent XSS - strip script tags and dangerous attributes
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  // Remove script tags and their content
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  // Remove on* event handlers
  html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
  // Remove javascript: protocol
  html = html.replace(/javascript\s*:/gi, '');
  // Remove iframe tags
  html = html.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '');
  // Remove object tags
  html = html.replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '');
  // Remove embed tags
  html = html.replace(/<embed[\s\S]*?>/gi, '');
  return html;
}

// POST /add_profile
app.post('/add_profile', (req, res, next) => {
  upload.fields([
    { name: 'username', maxCount: 1 },
    { name: 'profile_page', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'File upload error' });
      }
      return res.status(400).json({ error: 'Invalid input' });
    }

    try {
      const username = req.body.username;
      const profilePage = req.body.profile_page;
      const profilePhotoFile = req.files && req.files['profile_photo'] && req.files['profile_photo'][0];

      // Validate inputs
      if (!username || !profilePage || !profilePhotoFile) {
        return res.status(400).json({ error: 'Missing required fields: username, profile_page, profile_photo' });
      }

      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Invalid username. Only alphanumeric characters and underscores allowed, max 50 characters.' });
      }

      if (typeof profilePage !== 'string' || profilePage.length === 0) {
        return res.status(400).json({ error: 'Invalid profile_page content' });
      }

      if (profilePage.length > 500000) {
        return res.status(400).json({ error: 'Profile page content too large' });
      }

      // Sanitize HTML content
      const sanitizedProfilePage = sanitizeHtml(profilePage);

      const photoBuffer = profilePhotoFile.buffer;

      // Use parameterized query to prevent SQL injection
      db.run(
        'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
        [username, sanitizedProfilePage, photoBuffer],
        function(err) {
          if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return res.status(403).json({ error: 'Profile already exists' });
            }
            // Don't expose internal error details
            return res.status(500).json({ error: 'Failed to create profile' });
          }
          return res.status(201).json({ message: 'Profile created successfully' });
        }
      );
    } catch (e) {
      return res.status(400).json({ error: 'Invalid input' });
    }
  });
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  if (!isValidUsername(username)) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  // Use parameterized query to prevent SQL injection
  db.get(
    'SELECT profile_page FROM profiles WHERE username = ?',
    [username],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      // Set strict CSP for profile pages
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(row.profile_page);
    }
  );
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  if (!isValidUsername(username)) {
    return res.status(404).json({ error: 'Profile photo not found' });
  }

  // Use parameterized query to prevent SQL injection
  db.get(
    'SELECT profile_photo FROM profiles WHERE username = ?',
    [username],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!row || !row.profile_photo) {
        return res.status(404).json({ error: 'Profile photo not found' });
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(row.profile_photo);
    }
  );
});

// Generic error handler - avoid exposing sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;