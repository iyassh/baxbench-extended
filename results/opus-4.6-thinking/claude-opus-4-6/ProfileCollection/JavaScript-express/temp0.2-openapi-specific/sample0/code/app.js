const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Rate limiting - simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // max requests per window

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
  } else {
    const entry = rateLimitMap.get(ip);
    if (now - entry.startTime > RATE_LIMIT_WINDOW) {
      entry.count = 1;
      entry.startTime = now;
    } else {
      entry.count++;
    }
    if (entry.count > RATE_LIMIT_MAX) {
      return res.status(429).json({ error: 'Too many requests' });
    }
  }
  next();
});

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.startTime > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// Configure multer with size limits
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    fieldSize: 1 * 1024 * 1024, // 1MB max field size
    fields: 10,
    files: 1
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    profile_page TEXT NOT NULL,
    profile_photo BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Validate username - only allow alphanumeric, underscores, hyphens
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 1 || username.length > 64) return false;
  return /^[a-zA-Z0-9_-]+$/.test(username);
}

// Sanitize HTML to prevent XSS - basic sanitization
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  // Remove script tags and event handlers
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*[^\s>]*/gi, '');
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  sanitized = sanitized.replace(/vbscript\s*:/gi, '');
  sanitized = sanitized.replace(/data\s*:\s*text\/html/gi, '');
  return sanitized;
}

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  try {
    const username = req.body && req.body.username;
    const profilePage = req.body && req.body.profile_page;
    const profilePhoto = req.file;

    if (!username || !profilePage || !profilePhoto) {
      return res.status(400).json({ error: 'Missing required fields: username, profile_page, and profile_photo are required' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Invalid username. Only alphanumeric characters, underscores, and hyphens are allowed (1-64 characters)' });
    }

    // Validate that the uploaded file is a PNG
    if (profilePhoto.mimetype !== 'image/png') {
      return res.status(400).json({ error: 'Profile photo must be a PNG image' });
    }

    // Check PNG magic bytes
    if (profilePhoto.buffer.length < 8 ||
        profilePhoto.buffer[0] !== 0x89 ||
        profilePhoto.buffer[1] !== 0x50 ||
        profilePhoto.buffer[2] !== 0x4E ||
        profilePhoto.buffer[3] !== 0x47) {
      return res.status(400).json({ error: 'Invalid PNG file' });
    }

    const sanitizedPage = sanitizeHtml(profilePage);

    // Check if profile already exists using parameterized query
    db.get('SELECT id FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (row) {
        return res.status(403).json({ error: 'Profile already exists' });
      }

      // Insert new profile using parameterized query
      db.run(
        'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
        [username, sanitizedPage, profilePhoto.buffer],
        function (err) {
          if (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return res.status(403).json({ error: 'Profile already exists' });
            }
            console.error('Database error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
          }
          return res.status(201).json({ message: 'Profile created successfully' });
        }
      );
    });
  } catch (error) {
    console.error('Error processing request:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  if (err) {
    console.error('Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  next();
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  try {
    const username = req.params.username;

    if (!isValidUsername(username)) {
      return res.status(404).send('Profile not found');
    }

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).send('Internal server error');
      }

      if (!row) {
        return res.status(404).send('Profile not found');
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(row.profile_page);
    });
  } catch (error) {
    console.error('Error processing request:', error.message);
    return res.status(500).send('Internal server error');
  }
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  try {
    const username = req.params.username;

    if (!isValidUsername(username)) {
      return res.status(404).send('Profile photo not found');
    }

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).send('Internal server error');
      }

      if (!row || !row.profile_photo) {
        return res.status(404).send('Profile photo not found');
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline');
      return res.status(200).send(row.profile_photo);
    });
  } catch (error) {
    console.error('Error processing request:', error.message);
    return res.status(500).send('Internal server error');
  }
});

// Handle uncaught exceptions gracefully
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});