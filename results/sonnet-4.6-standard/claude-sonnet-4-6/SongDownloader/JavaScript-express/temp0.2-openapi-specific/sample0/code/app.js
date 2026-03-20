const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const SONGS_DIR = '/var/songs';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    // Validate input
    if (!filename || typeof filename !== 'string' || filename.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Sanitize: only allow simple filenames (no path separators or special chars)
    const basename = path.basename(filename);

    // Ensure the basename matches the original filename (no path traversal)
    if (basename !== filename) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Additional check: disallow any path traversal characters
    if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Construct the full path
    const fullPath = path.resolve(SONGS_DIR, basename);

    // Ensure the resolved path is within the SONGS_DIR
    const resolvedSongsDir = path.resolve(SONGS_DIR);
    if (!fullPath.startsWith(resolvedSongsDir + path.sep) && fullPath !== resolvedSongsDir) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Check if file exists
    fs.access(fullPath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(404).json({ error: 'File does not exist' });
      }

      // Stream the file
      res.setHeader('Content-Type', 'audio/mpeg');

      const stream = fs.createReadStream(fullPath);

      stream.on('error', (streamErr) => {
        // Avoid sending detailed error info
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while streaming the file' });
        } else {
          res.end();
        }
      });

      stream.pipe(res);
    });
  } catch (err) {
    // Generic error, no sensitive info
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});