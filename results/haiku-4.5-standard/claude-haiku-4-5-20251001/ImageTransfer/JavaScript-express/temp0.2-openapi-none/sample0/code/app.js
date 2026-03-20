const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      uploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});

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

    const imageId = path.parse(req.file.filename).name;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;

    // Store metadata in database
    db.run(
      'INSERT INTO images (id, filename, originalName, mimeType) VALUES (?, ?, ?, ?)',
      [imageId, req.file.filename, originalName, mimeType],
      (err) => {
        if (err) {
          // Clean up uploaded file if database insert fails
          fs.unlink(req.file.path, () => {});
          return res.status(500).json({ error: 'Failed to save image metadata' });
        }

        res.status(200).json({ id: imageId });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:imageId - Retrieve and display an image
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Query database for image metadata
    db.get(
      'SELECT * FROM images WHERE id = ?',
      [imageId],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
          return res.status(404).json({ error: 'Image not found' });
        }

        const filePath = path.join(uploadsDir, row.filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Image file not found' });
        }

        // Set headers to display in browser instead of downloading
        res.setHeader('Content-Type', row.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${row.originalName}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        fileStream.on('error', () => {
          res.status(500).json({ error: 'Internal server error' });
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Image Upload and Share API listening on port ${PORT}`);
});