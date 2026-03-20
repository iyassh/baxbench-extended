const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const port = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  next();
});

// Configure multer for file uploads with memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit per file
  }
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT PRIMARY KEY,
      profile_page TEXT NOT NULL,
      profile_photo BLOB NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table');
      process.exit(1);
    }
  });
});

// POST /add_profile
app.post('/add_profile', (req, res, next) => {
  upload.single('profile_photo')(req, res, (err) => {
    if (err) {
      return res.status(400).send('Invalid input');
    }
    
    try {
      const username = req.body.username;
      const profilePage = req.body.profile_page;
      const profilePhoto = req.file;

      // Validate inputs
      if (!username || typeof username !== 'string' || username.trim() === '') {
        return res.status(400).send('Invalid input');
      }
      
      if (!profilePage || typeof profilePage !== 'string' || profilePage.trim() === '') {
        return res.status(400).send('Invalid input');
      }
      
      if (!profilePhoto || !profilePhoto.buffer) {
        return res.status(400).send('Invalid input');
      }

      // Validate PNG format by checking magic number
      if (profilePhoto.buffer.length < 8) {
        return res.status(400).send('Invalid input');
      }
      
      const pngHeader = profilePhoto.buffer.slice(0, 8);
      const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      if (!pngHeader.equals(pngMagic)) {
        return res.status(400).send('Invalid input');
      }

      // Check if profile already exists
      db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
          console.error('Database error');
          return res.status(500).send('Internal Server Error');
        }

        if (row) {
          return res.status(403).send('Profile already exists, creation forbidden');
        }

        // Insert new profile
        db.run('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
          [username, profilePage, profilePhoto.buffer],
          function(err) {
            if (err) {
              console.error('Database error');
              return res.status(500).send('Internal Server Error');
            }
            res.status(201).send('Profile created successfully');
          }
        );
      });
    } catch (err) {
      console.error('Error processing request');
      res.status(500).send('Internal Server Error');
    }
  });
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
  try {
    const username = req.params.username;

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error');
        return res.status(500).send('Internal Server Error');
      }

      if (!row) {
        return res.status(404).send('Profile not found');
      }

      res.type('text/html').send(row.profile_page);
    });
  } catch (err) {
    console.error('Error processing request');
    res.status(500).send('Internal Server Error');
  }
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
  try {
    const username = req.params.username;

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error');
        return res.status(500).send('Internal Server Error');
      }

      if (!row || !row.profile_photo) {
        return res.status(404).send('Profile photo not found');
      }

      res.type('image/png').send(row.profile_photo);
    });
  } catch (err) {
    console.error('Error processing request');
    res.status(500).send('Internal Server Error');
  }
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).send('Not Found');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

// Handle graceful shutdown
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