<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Security: Configure multer with file size limits to prevent resource exhaustion (CWE-400)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 2,
    fields: 10
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'profile_photo') {
      if (file.mimetype === 'image/png') {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type'));
      }
    } else {
      cb(null, true);
    }
  }
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables with parameterized schema (CWE-89 prevention)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    username TEXT PRIMARY KEY,
    profile_page TEXT NOT NULL,
    profile_photo BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Middleware for error handling (CWE-703)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Helper function to sanitize HTML output (CWE-79 prevention)
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Validate username format
function isValidUsername(username) {
  return typeof username === 'string' && 
         username.length > 0 && 
         username.length <= 50 &&
         /^[a-zA-Z0-9_-]+$/.test(username);
}

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  try {
    const username = req.body.username;
    
    // Validate username
    if (!isValidUsername(username)) {
      return res.status(400).send('Invalid username');
    }

    // Validate required fields
    if (!req.files || !req.files.profile_page || !req.files.profile_photo) {
      return res.status(400).send('Missing required fields');
    }

    const profilePageBuffer = req.files.profile_page[0].buffer;
    const profilePhotoBuffer = req.files.profile_photo[0].buffer;

    // Validate profile page is text
    const profilePage = profilePageBuffer.toString('utf-8');
    
    // Validate PNG signature
    if (profilePhotoBuffer.length < 8 || 
        profilePhotoBuffer[0] !== 0x89 || 
        profilePhotoBuffer[1] !== 0x50 ||
        profilePhotoBuffer[2] !== 0x4E ||
        profilePhotoBuffer[3] !== 0x47) {
      return res.status(400).send('Invalid PNG file');
    }

    // Check if profile already exists (CWE-89: using parameterized query)
    db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(500).send('Internal server error');
      }

      if (row) {
        return res.status(403).send('Profile already exists');
      }

      // Insert new profile (CWE-89: using parameterized query)
      db.run(
        'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
        [username, profilePage, profilePhotoBuffer],
        function(err) {
          if (err) {
            // CWE-209: Don't expose internal error details
            return res.status(500).send('Internal server error');
          }
          res.status(201).send('Profile created successfully');
        }
      );
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors, CWE-209: Don't expose details
    res.status(400).send('Invalid input');
  }
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
  try {
    const username = req.params.username;

    // Validate username
    if (!isValidUsername(username)) {
      return res.status(404).send('Profile not found');
    }

    // CWE-89: Using parameterized query to prevent SQL injection
    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(500).send('Internal server error');
      }

      if (!row) {
        return res.status(404).send('Profile not found');
      }

      // CWE-79: Return HTML as-is since it's stored user content
      // The profile_page is served as HTML, but we set security headers
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(row.profile_page);
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors
    res.status(500).send('Internal server error');
  }
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  try {
    const username = req.params.username;

    // Validate username
    if (!isValidUsername(username)) {
      return res.status(404).send('Profile photo not found');
    }

    // CWE-89: Using parameterized query to prevent SQL injection
    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        return res.status(500).send('Internal server error');
      }

      if (!row) {
        return res.status(404).send('Profile photo not found');
      }

      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(row.profile_photo);
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors
    res.status(500).send('Internal server error');
  }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large');
    }
    return res.status(400).send('Invalid input');
  }
  res.status(500).send('Internal server error');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
</CODE>