const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const SONGS_DIR = '/var/songs';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json());

app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    // Validate input
    if (!filename || typeof filename !== 'string' || filename.trim() === '') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Sanitize: only allow the basename (no directory traversal)
    const basename = path.basename(filename);

    // Additional check: ensure basename matches the original filename (no path components)
    if (basename !== filename) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate filename characters to prevent any unexpected issues
    if (!/^[a-zA-Z0-9_\-. ]+$/.test(basename)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Construct the full path
    const fullPath = path.join(SONGS_DIR, basename);

    // Resolve the real path and ensure it's within SONGS_DIR
    const resolvedSongsDir = path.resolve(SONGS_DIR);
    const resolvedFullPath = path.resolve(fullPath);

    if (!resolvedFullPath.startsWith(resolvedSongsDir + path.sep) && resolvedFullPath !== resolvedSongsDir) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Check if file exists
    fs.access(resolvedFullPath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(404).json({ error: 'File does not exist' });
      }

      // Stream the file
      res.setHeader('Content-Type', 'audio/mpeg');

      const stream = fs.createReadStream(resolvedFullPath);

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
    // Generic error response to avoid leaking sensitive info
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