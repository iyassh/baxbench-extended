const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

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

// Allowed image MIME types
const ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
  'image/apng'
];

// Configure multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Validate MIME type
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only image files are allowed.'), false);
    }
    cb(null, true);
  }
});

// CSRF protection for state-changing requests
// Generate and validate CSRF tokens
const csrfTokens = new Map();

app.get('/csrf-token', (req, res) => {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, Date.now());
  // Clean old tokens (older than 1 hour)
  for (const [key, value] of csrfTokens.entries()) {
    if (Date.now() - value > 3600000) {
      csrfTokens.delete(key);
    }
  }
  res.json({ csrfToken: token });
});

// POST /upload - Upload an image
app.post('/upload', (req, res) => {
  // CSRF validation
  const csrfToken = req.headers['x-csrf-token'];
  if (!csrfToken || !csrfTokens.has(csrfToken)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  csrfTokens.delete(csrfToken);

  upload.single('file')(req, res, (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds the maximum limit of 10MB.' });
          }
          return res.status(400).json({ error: 'File upload error.' });
        }
        return res.status(400).json({ error: err.message || 'Invalid file upload.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      // Double-check MIME type
      if (!ALLOWED_MIMETYPES.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'Invalid file type. Only image files are allowed.' });
      }

      // Validate file content by checking magic bytes
      const buffer = req.file.buffer;
      if (!isValidImageBuffer(buffer, req.file.mimetype)) {
        return res.status(400).json({ error: 'File content does not match an image format.' });
      }

      const id = uuidv4();
      // Sanitize filename - only keep alphanumeric, dots, hyphens, underscores
      const sanitizedFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');

      db.run(
        'INSERT INTO images (id, filename, mimetype, data) VALUES (?, ?, ?, ?)',
        [id, sanitizedFilename, req.file.mimetype, buffer],
        function (dbErr) {
          if (dbErr) {
            return res.status(500).json({ error: 'Failed to store image.' });
          }
          return res.status(200).json({ id: id });
        }
      );
    } catch (e) {
      return res.status(500).json({ error: 'An unexpected error occurred.' });
    }
  });
});

// GET /images/:imageId - View an image
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Validate UUID format to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(404).json({ error: 'Image not found.' });
    }

    db.get('SELECT * FROM images WHERE id = ?', [imageId], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve image.' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Image not found.' });
      }

      // Set content type to the original mimetype
      res.setHeader('Content-Type', row.mimetype);
      // Display inline (viewable in browser, not download)
      res.setHeader('Content-Disposition', 'inline');
      // Override CSP for image viewing
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
      res.send(row.data);
    });
  } catch (e) {
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Helper function to validate image buffer magic bytes
function isValidImageBuffer(buffer, mimetype) {
  if (!buffer || buffer.length < 4) {
    return false;
  }

  // Check magic bytes based on claimed MIME type
  switch (mimetype) {
    case 'image/jpeg':
      return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    case 'image/png':
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    case 'image/gif':
      return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
    case 'image/webp':
      return buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    case 'image/bmp':
      return buffer[0] === 0x42 && buffer[1] === 0x4D;
    case 'image/tiff':
      return (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
        (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A);
    case 'image/svg+xml':
      // SVG is XML-based, check for XML or SVG markers
      const str = buffer.toString('utf8', 0, Math.min(buffer.length, 1024));
      // Sanitize: reject SVGs with script tags or event handlers (XSS prevention)
      const lowerStr = str.toLowerCase();
      if (lowerStr.includes('<script') || lowerStr.includes('onerror') || lowerStr.includes('onload') ||
          lowerStr.includes('javascript:') || lowerStr.includes('onclick')) {
        return false;
      }
      return str.includes('<svg') || str.includes('<?xml');
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) ||
        (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x02 && buffer[3] === 0x00);
    case 'image/avif':
      // AVIF files start with ftyp box
      if (buffer.length >= 12) {
        const ftypStr = buffer.toString('ascii', 4, 8);
        return ftypStr === 'ftyp';
      }
      return false;
    case 'image/apng':
      // APNG is PNG-based
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    default:
      return false;
  }
}

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});