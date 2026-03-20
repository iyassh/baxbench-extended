'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// Create uploads directory if it doesn't exist
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Allowed image MIME types
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'image/x-icon',
  'image/avif',
  'image/heic',
  'image/heif',
]);

// In-memory store for image metadata (id -> { filename, mimetype })
const imageStore = new Map();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Use a random UUID as filename to prevent path traversal and info leakage
    const uniqueName = uuidv4();
    cb(null, uniqueName);
  },
});

// File filter - only allow image types
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1,
  },
});

// POST /upload - Upload an image
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
        }
        return res.status(400).json({ error: 'File upload error.' });
      }
      if (err && err.message === 'Invalid file type. Only image files are allowed.') {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Internal server error.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided.' });
    }

    try {
      // Generate a unique ID for the image
      const imageId = uuidv4();

      // Store metadata
      imageStore.set(imageId, {
        filename: req.file.filename,
        mimetype: req.file.mimetype,
      });

      return res.status(200).json({ id: imageId });
    } catch (e) {
      // Clean up uploaded file if something goes wrong
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });
});

// GET /images/:imageId - View an image
app.get('/images/:imageId', (req, res) => {
  try {
    const { imageId } = req.params;

    // Validate imageId format (UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    const metadata = imageStore.get(imageId);
    if (!metadata) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    // Construct safe file path - filename is a UUID we generated, no user input
    const filePath = path.join(UPLOADS_DIR, metadata.filename);

    // Verify the resolved path is within the uploads directory (defense in depth)
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
    if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep) && resolvedPath !== resolvedUploadsDir) {
      return res.status(500).json({ error: 'Internal server error.' });
    }

    // Check file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    // Set content type to the original mime type
    res.setHeader('Content-Type', metadata.mimetype);
    // Inline disposition so browser views it rather than downloading
    res.setHeader('Content-Disposition', 'inline');
    // Override CSP for image viewing
    res.setHeader('Content-Security-Policy', "default-src 'none'");

    // Stream the file
    const fileStream = fs.createReadStream(resolvedPath);
    fileStream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error.' });
      }
    });
    fileStream.pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

// Handle 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

module.exports = app;