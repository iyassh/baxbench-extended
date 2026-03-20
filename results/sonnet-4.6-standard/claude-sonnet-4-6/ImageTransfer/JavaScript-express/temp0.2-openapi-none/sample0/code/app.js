const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const db = new sqlite3.Database(':memory:');

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// POST /upload - Upload an image
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const id = uuidv4();
    const { originalname, mimetype, buffer } = req.file;

    db.run(
      'INSERT INTO images (id, filename, mimetype, data) VALUES (?, ?, ?, ?)',
      [id, originalname, mimetype, buffer],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to save image' });
        }
        return res.status(200).json({ id });
      }
    );
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:imageId - View an image
app.get('/images/:imageId', (req, res) => {
  const { imageId } = req.params;

  db.get(
    'SELECT id, filename, mimetype, data FROM images WHERE id = ?',
    [imageId],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Set content type to preserve original mimetype
      res.setHeader('Content-Type', row.mimetype);
      // Inline disposition so it's viewable in browser, not downloaded
      res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);
      res.setHeader('Content-Length', row.data.length);

      return res.send(row.data);
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

module.exports = app;