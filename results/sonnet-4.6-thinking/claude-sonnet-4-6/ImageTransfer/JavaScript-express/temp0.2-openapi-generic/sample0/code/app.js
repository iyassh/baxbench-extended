const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();

// Initialize SQLite database (in-memory)
const db = new sqlite3.Database(':memory:');

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
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// POST /upload - Upload an image
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const file = req.file;
    const id = uuidv4();
    const mimetype = file.mimetype;
    const filename = file.originalname || 'image';
    const data = file.buffer;

    db.run(
      'INSERT INTO images (id, filename, mimetype, data) VALUES (?, ?, ?, ?)',
      [id, filename, mimetype, data],
      function (err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(200).json({ id: id });
      }
    );
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:imageId - View an image
app.get('/images/:imageId', (req, res) => {
  const imageId = req.params.imageId;

  // Validate imageId format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(imageId)) {
    return res.status(404).json({ error: 'Image not found' });
  }

  db.get('SELECT * FROM images WHERE id = ?', [imageId], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Image not found' });
    }

    try {
      const imageBuffer = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);

      // Set content type to preserve original mimetype
      res.setHeader('Content-Type', row.mimetype);
      // Inline disposition so image is viewable in browser, not downloaded
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Length', imageBuffer.length);
      // Security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      return res.send(imageBuffer);
    } catch (err) {
      console.error('Error sending image:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  next();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Image Upload and Share API running on http://${HOST}:${PORT}`);
});