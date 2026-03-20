const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
      mimetype TEXT NOT NULL,
      filepath TEXT NOT NULL,
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
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept all file formats as per spec
    cb(null, true);
  }
});

// Middleware
app.use(express.json());

// POST /upload - Upload an image
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const imageId = uuidv4();
    const filepath = req.file.path;
    const mimetype = req.file.mimetype;
    const filename = req.file.filename;

    // Store metadata in database
    db.run(
      'INSERT INTO images (id, filename, mimetype, filepath) VALUES (?, ?, ?, ?)',
      [imageId, filename, mimetype, filepath],
      (err) => {
        if (err) {
          // Clean up uploaded file if database insert fails
          fs.unlink(filepath, () => {});
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
    const { imageId } = req.params;

    // Validate imageId format (UUID)
    if (!isValidUUID(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }

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

        const filepath = row.filepath;

        // Check if file exists
        if (!fs.existsSync(filepath)) {
          return res.status(404).json({ error: 'Image not found' });
        }

        // Set appropriate headers to display in browser instead of download
        res.setHeader('Content-Type', row.mimetype);
        res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Stream the file
        const fileStream = fs.createReadStream(filepath);
        fileStream.on('error', () => {
          res.status(500).json({ error: 'Internal server error' });
        });

        fileStream.pipe(res);
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Helper function to validate UUID format
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Image Upload and Share API listening on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});