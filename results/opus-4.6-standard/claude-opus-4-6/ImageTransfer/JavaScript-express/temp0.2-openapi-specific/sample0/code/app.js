const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize SQLite database (store images as BLOBs)
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Allowed image MIME types (CWE-434)
const ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/svg+xml',
  'image/tiff',
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
    // Validate MIME type (CWE-434)
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

// CSRF token generation and validation (CWE-352)
const csrfTokens = new Map();

function generateCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, Date.now());
  // Clean up old tokens (older than 1 hour)
  for (const [key, timestamp] of csrfTokens.entries()) {
    if (Date.now() - timestamp > 3600000) {
      csrfTokens.delete(key);
    }
  }
  return token;
}

function validateCsrfToken(token) {
  if (!token || !csrfTokens.has(token)) {
    return false;
  }
  const timestamp = csrfTokens.get(token);
  if (Date.now() - timestamp > 3600000) {
    csrfTokens.delete(token);
    return false;
  }
  csrfTokens.delete(token); // Single use
  return true;
}

// Endpoint to get a CSRF token
app.get('/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  res.json({ csrfToken: token });
});

// Upload endpoint (CWE-352 protection with CSRF token)
app.post('/upload', (req, res) => {
  // Validate CSRF token
  const csrfToken = req.headers['x-csrf-token'];
  if (!validateCsrfToken(csrfToken)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  upload.single('file')(req, res, (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds the 10MB limit.' });
          }
          return res.status(400).json({ error: 'File upload error.' });
        }
        return res.status(400).json({ error: err.message || 'Invalid file upload.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      // Double-check MIME type (CWE-434)
      if (!ALLOWED_MIMETYPES.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'Invalid file type. Only image files are allowed.' });
      }

      const id = uuidv4();
      // Sanitize filename (CWE-22, CWE-79)
      const sanitizedFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');

      db.run(
        'INSERT INTO images (id, filename, mimetype, data) VALUES (?, ?, ?, ?)',
        [id, sanitizedFilename, req.file.mimetype, req.file.buffer],
        (dbErr) => {
          if (dbErr) {
            // CWE-209: Don't expose internal error details
            console.error('Database error:', dbErr.message);
            return res.status(500).json({ error: 'Failed to store image.' });
          }
          return res.status(200).json({ id: id });
        }
      );
    } catch (error) {
      // CWE-703, CWE-209
      console.error('Unexpected error during upload:', error.message);
      return res.status(500).json({ error: 'An unexpected error occurred.' });
    }
  });
});

// Image viewing endpoint
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Validate UUID format (CWE-22, CWE-79)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(400).json({ error: 'Invalid image ID format.' });
    }

    db.get('SELECT * FROM images WHERE id = ?', [imageId], (err, row) => {
      if (err) {
        // CWE-209
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve image.' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Image not found.' });
      }

      // Validate stored mimetype is still in allowed list
      if (!ALLOWED_MIMETYPES.includes(row.mimetype)) {
        return res.status(500).json({ error: 'Invalid stored image type.' });
      }

      // For SVG, serve as plain image to prevent XSS (CWE-79)
      let contentType = row.mimetype;
      if (contentType === 'image/svg+xml') {
        // Serve SVG with content security to prevent embedded scripts
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      }

      // Set headers to display inline (not download) and preserve mimetype
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      return res.send(row.data);
    });
  } catch (error) {
    // CWE-703, CWE-209
    console.error('Unexpected error during image retrieval:', error.message);
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});