'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();

// Create uploads directory if it doesn't exist
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { mode: 0o700 });
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

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; frame-ancestors 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// In-memory store for image metadata: { id -> { filename, mimetype } }
const imageStore = new Map();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Use UUID as filename to avoid path traversal and info leakage
    const id = uuidv4();
    cb(null, id);
  },
});

// File filter: only allow image MIME types
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1,
  },
});

// POST /upload
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Invalid file type. Only image files are allowed.' });
        }
        return res.status(400).json({ error: 'File upload error.' });
      }
      return res.status(500).json({ error: 'Internal server error.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided.' });
    }

    const id = req.file.filename; // UUID used as filename
    const mimetype = req.file.mimetype;

    // Double-check mime type
    if (!ALLOWED_MIME_TYPES.has(mimetype)) {
      // Remove the file
      try {
        fs.unlinkSync(path.join(UPLOADS_DIR, id));
      } catch (e) {
        // ignore
      }
      return res.status(400).json({ error: 'Invalid file type.' });
    }

    // Store metadata
    imageStore.set(id, { filename: id, mimetype });

    return res.status(200).json({ id });
  });
});

// GET /images/:imageId
app.get('/images/:imageId', (req, res) => {
  const imageId = req.params.imageId;

  // Validate imageId is a valid UUID (alphanumeric and hyphens only)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(imageId)) {
    return res.status(404).json({ error: 'Image not found.' });
  }

  const metadata = imageStore.get(imageId);
  if (!metadata) {
    return res.status(404).json({ error: 'Image not found.' });
  }

  // Construct safe file path
  const filePath = path.join(UPLOADS_DIR, metadata.filename);

  // Ensure the resolved path is within UPLOADS_DIR (prevent path traversal)
  const resolvedPath = path.resolve(filePath);
  const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep) && resolvedPath !== resolvedUploadsDir) {
    return res.status(404).json({ error: 'Image not found.' });
  }

  // Check file exists
  fs.access(resolvedPath, fs.constants.R_OK, (accessErr) => {
    if (accessErr) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    // Set headers to display inline (not download)
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', metadata.mimetype);
    // Override CSP for image viewing
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Internal server error.' });
      }
    });
    stream.pipe(res);
  });
});

// Handle 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});