const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();

// Configure multer with limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1,
    fields: 10
  }
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Rate limiting - simple in-memory implementation
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100;

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, startTime: now });
  } else {
    const record = requestCounts.get(ip);
    if (now - record.startTime > RATE_LIMIT_WINDOW) {
      record.count = 1;
      record.startTime = now;
    } else {
      record.count++;
      if (record.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests' });
      }
    }
  }
  next();
});

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of requestCounts.entries()) {
    if (now - record.startTime > RATE_LIMIT_WINDOW) {
      requestCounts.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// Body size limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

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

// Validate username - alphanumeric and underscores only
function isValidUsername(username) {
  if (typeof username !== 'string') return false;
  if (username.length === 0 || username.length > 64) return false;
  return /^[a-zA-Z0-9_]+$/.test(username);
}

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  try {
    const { username, profile_page } = req.body;
    const profilePhoto = req.file;

    // Validate input
    if (!username || !profile_page || !profilePhoto) {
      return res.status(400).json({ error: 'Missing required fields: username, profile_page, and profile_photo are required' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Invalid username. Only alphanumeric characters and underscores are allowed, max 64 characters.' });
    }

    if (typeof profile_page !== 'string' || profile_page.length === 0) {
      return res.status(400).json({ error: 'Invalid profile page content' });
    }

    // Validate PNG file
    if (profilePhoto.mimetype !== 'image/png') {
      return res.status(400).json({ error: 'Profile photo must be a PNG image' });
    }

    // Check PNG magic bytes
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (profilePhoto.buffer.length < 8 || !profilePhoto.buffer.subarray(0, 8).equals(pngMagic)) {
      return res.status(400).json({ error: 'Profile photo is not a valid PNG file' });
    }

    // Sanitize HTML content
    const sanitizedPage = sanitizeHtml(profile_page);

    // Check if profile already exists using parameterized query
    db.get('SELECT id FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error');
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
            if (err.message && err.message.includes('UNIQUE constraint')) {
              return res.status(403).json({ error: 'Profile already exists' });
            }
            console.error('Database error');
            return res.status(500).json({ error: 'Internal server error' });
          }
          return res.status(201).json({ message: 'Profile created successfully' });
        }
      );
    });
  } catch (error) {
    console.error('Unexpected error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!isValidUsername(username)) {
      return res.status(404).send('Profile not found');
    }

    // Use parameterized query to prevent SQL injection
    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error');
        return res.status(500).send('Internal server error');
      }

      if (!row) {
        return res.status(404).send('Profile not found');
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(row.profile_page);
    });
  } catch (error) {
    console.error('Unexpected error');
    return res.status(500).send('Internal server error');
  }
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  try {
    const { username } = req.params;

    if (!isValidUsername(username)) {
      return res.status(404).send('Profile photo not found');
    }

    // Use parameterized query to prevent SQL injection
    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error');
        return res.status(500).send('Internal server error');
      }

      if (!row || !row.profile_photo) {
        return res.status(404).send('Profile photo not found');
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', row.profile_photo.length);
      return res.status(200).send(row.profile_photo);
    });
  } catch (error) {
    console.error('Unexpected error');
    return res.status(500).send('Internal server error');
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
  console.error('Unhandled error');
  return res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});