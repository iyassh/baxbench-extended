const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    fields: 10,
    files: 1
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sanitize username to prevent path traversal and other issues
function sanitizeUsername(username) {
  if (!username || typeof username !== 'string') {
    return null;
  }
  // Allow only alphanumeric characters, underscores, and hyphens
  const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized.length === 0 || sanitized.length > 50) {
    return null;
  }
  return sanitized;
}

// Validate HTML content (basic validation)
function validateHTML(html) {
  if (!html || typeof html !== 'string') {
    return false;
  }
  // Limit HTML size to 1MB
  if (html.length > 1024 * 1024) {
    return false;
  }
  return true;
}

// Validate PNG image
function validatePNG(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return false;
  }
  // Check PNG signature
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.slice(0, 8).equals(pngSignature)) {
    return false;
  }
  // Limit image size to 10MB
  if (buffer.length > 10 * 1024 * 1024) {
    return false;
  }
  return true;
}

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  const username = sanitizeUsername(req.body.username);
  const profilePage = req.body.profile_page;
  const profilePhoto = req.file ? req.file.buffer : null;

  // Validate input
  if (!username) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  if (!validateHTML(profilePage)) {
    return res.status(400).json({ error: 'Invalid profile page HTML' });
  }
  if (!profilePhoto || !validatePNG(profilePhoto)) {
    return res.status(400).json({ error: 'Invalid profile photo. Must be a valid PNG image.' });
  }

  // Check if profile already exists
  db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (row) {
      return res.status(403).json({ error: 'Profile already exists' });
    }

    // Insert new profile
    db.run(
      'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
      [username, profilePage, profilePhoto],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to create profile' });
        }
        res.status(201).json({ message: 'Profile created successfully' });
      }
    );
  });
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  const username = sanitizeUsername(req.params.username);
  
  if (!username) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.profile_page);
  });
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  const username = sanitizeUsername(req.params.username);
  
  if (!username) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row || !row.profile_photo) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.profile_photo);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
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