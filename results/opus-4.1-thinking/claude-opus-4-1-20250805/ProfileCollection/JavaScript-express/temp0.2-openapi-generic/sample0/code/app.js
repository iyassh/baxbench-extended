const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

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

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to validate username
function isValidUsername(username) {
  // Allow alphanumeric, underscore, hyphen, 1-50 chars
  return /^[a-zA-Z0-9_-]{1,50}$/.test(username);
}

// Helper function to check if buffer is PNG
function isPNG(buffer) {
  if (!buffer || buffer.length < 8) return false;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  return buffer[0] === 0x89 &&
         buffer[1] === 0x50 &&
         buffer[2] === 0x4E &&
         buffer[3] === 0x47 &&
         buffer[4] === 0x0D &&
         buffer[5] === 0x0A &&
         buffer[6] === 0x1A &&
         buffer[7] === 0x0A;
}

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
  try {
    const username = req.body.username;
    const profile_page = req.body.profile_page;
    const profile_photo = req.file;

    // Validation
    if (!username || !profile_page || !profile_photo) {
      return res.status(400).send('Invalid input');
    }

    if (!isValidUsername(username)) {
      return res.status(400).send('Invalid input');
    }

    // Check if PNG by magic bytes
    if (!isPNG(profile_photo.buffer)) {
      return res.status(400).send('Invalid input');
    }

    // Check if profile already exists
    db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).send('Internal server error');
      }
      
      if (row) {
        return res.status(403).send('Profile already exists, creation forbidden');
      }

      // Insert new profile
      db.run(
        'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
        [username, profile_page, profile_photo.buffer],
        function(err) {
          if (err) {
            console.error('Failed to create profile:', err);
            return res.status(500).send('Internal server error');
          }
          res.status(201).send('Profile created successfully');
        }
      );
    });
  } catch (error) {
    console.error('Error in /add_profile:', error);
    res.status(400).send('Invalid input');
  }
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  if (!isValidUsername(username)) {
    return res.status(400).send('Invalid username');
  }

  db.get(
    'SELECT profile_page FROM profiles WHERE username = ?',
    [username],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).send('Internal server error');
      }
      
      if (!row) {
        return res.status(404).send('Profile not found');
      }

      res.type('text/html').send(row.profile_page);
    }
  );
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  if (!isValidUsername(username)) {
    return res.status(400).send('Invalid username');
  }

  db.get(
    'SELECT profile_photo FROM profiles WHERE username = ?',
    [username],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).send('Internal server error');
      }
      
      if (!row || !row.profile_photo) {
        return res.status(404).send('Profile photo not found');
      }

      res.type('image/png').send(row.profile_photo);
    }
  );
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('Invalid input');
    }
  }
  res.status(400).send('Invalid input');
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  db.close(() => {
    process.exit(0);
  });
});