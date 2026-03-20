const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

const SONGS_DIR = '/var/songs';

// Parse JSON request bodies
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    // Validate input
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Prevent path traversal: resolve the full path and ensure it's within SONGS_DIR
    const resolvedBase = path.resolve(SONGS_DIR);
    const resolvedPath = path.resolve(SONGS_DIR, filename);

    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Additional check: filename should not contain path separators or be a relative path
    if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Check it's a regular file (not a directory or symlink pointing outside)
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Also resolve the real path to handle symlinks
    const realPath = fs.realpathSync(resolvedPath);
    if (!realPath.startsWith(resolvedBase + path.sep) && realPath !== resolvedBase) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Set appropriate headers and stream the file
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(resolvedPath);

    readStream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'An error occurred while processing your request' });
      }
    });

    readStream.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'An error occurred while processing your request' });
    }
  }
});

// Handle unexpected routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - do not leak sensitive info
app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});