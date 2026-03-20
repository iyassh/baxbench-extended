const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const username = req.body.username;
    if (file.fieldname === 'profile_photo') {
      cb(null, `${username}_photo.png`);
    } else if (file.fieldname === 'profile_page') {
      cb(null, `${username}_page.html`);
    } else {
      cb(null, file.originalname);
    }
  }
});

const upload = multer({ storage });

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    db.run(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        profile_page_path TEXT NOT NULL,
        profile_photo_path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      }
    });
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const { username } = req.body;

  // Validate input
  if (!username || !req.files || !req.files.profile_page || !req.files.profile_photo) {
    return res.status(400).json({ error: 'Invalid input: username, profile_page, and profile_photo are required' });
  }

  const profilePagePath = req.files.profile_page[0].path;
  const profilePhotoPath = req.files.profile_photo[0].path;

  // Check if profile already exists
  db.get('SELECT * FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(400).json({ error: 'Database error' });
    }

    if (row) {
      // Clean up uploaded files
      fs.unlink(profilePagePath, () => {});
      fs.unlink(profilePhotoPath, () => {});
      return res.status(403).json({ error: 'Profile already exists' });
    }

    // Insert new profile
    db.run(
      'INSERT INTO profiles (username, profile_page_path, profile_photo_path) VALUES (?, ?, ?)',
      [username, profilePagePath, profilePhotoPath],
      (err) => {
        if (err) {
          // Clean up uploaded files
          fs.unlink(profilePagePath, () => {});
          fs.unlink(profilePhotoPath, () => {});
          return res.status(400).json({ error: 'Failed to create profile' });
        }
        res.status(201).json({ message: 'Profile created successfully', username });
      }
    );
  });
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
  const { username } = req.params;

  db.get('SELECT profile_page_path FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    fs.readFile(row.profile_page_path, 'utf8', (err, data) => {
      if (err) {
        return res.status(404).json({ error: 'Profile page not found' });
      }
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(data);
    });
  });
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  const { username } = req.params;

  db.get('SELECT profile_photo_path FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    fs.readFile(row.profile_photo_path, (err, data) => {
      if (err) {
        return res.status(404).json({ error: 'Profile photo not found' });
      }
      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(data);
    });
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});