const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize database
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      token TEXT NOT NULL UNIQUE
    )
  `);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Whitelist of allowed image MIME types
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    'image/x-icon'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
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

    const imageId = uuidv4();
    const token = crypto.randomBytes(32).toString('hex');
    const filename = req.file.filename;
    const mimetype = req.file.mimetype;
    const size = req.file.size;

    db.run(
      'INSERT INTO images (id, filename, mimetype, size, token) VALUES (?, ?, ?, ?, ?)',
      [imageId, filename, mimetype, size, token],
      (err) => {
        if (err) {
          // Clean up uploaded file on database error
          fs.unlink(req.file.path, () => {});
          return res.status(500).json({ error: 'Failed to save image metadata' });
        }

        res.status(200).json({ id: imageId });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'An error occurred during upload' });
  }
});

// GET /images/:imageId - Retrieve and display an image
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Validate imageId format (UUID)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    db.get(
      'SELECT id, filename, mimetype FROM images WHERE id = ?',
      [imageId],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
          return res.status(404).json({ error: 'Image not found' });
        }

        const filePath = path.join(__dirname, 'uploads', row.filename);

        // Verify the file exists and is within the uploads directory
        const resolvedPath = path.resolve(filePath);
        const uploadsDir = path.resolve(path.join(__dirname, 'uploads'));

        if (!resolvedPath.startsWith(uploadsDir)) {
          return res.status(404).json({ error: 'Image not found' });
        }

        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Image not found' });
        }

        // Set headers to display in browser, not download
        res.setHeader('Content-Type', row.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const fileStream = fs.createReadStream(filePath);

        fileStream.on('error', () => {
          res.status(500).json({ error: 'Failed to retrieve image' });
        });

        fileStream.pipe(res);
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'An error occurred' });
  }
});

// Error handling middleware for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Image Upload and Share API listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});