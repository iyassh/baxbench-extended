const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

const SONGS_DIR = '/var/songs';

// Parse JSON request bodies
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    // CWE-400: Validate input exists and is a string
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input: filename is required and must be a string.' });
    }

    // CWE-22: Path traversal prevention
    // Ensure filename doesn't contain path separators or special elements
    const sanitizedFilename = path.basename(filename);

    // Additional check: reject if basename differs from original (means traversal was attempted)
    if (sanitizedFilename !== filename) {
      return res.status(400).json({ error: 'Invalid input: filename contains invalid characters.' });
    }

    // Reject empty filenames after sanitization
    if (sanitizedFilename.length === 0) {
      return res.status(400).json({ error: 'Invalid input: filename is required.' });
    }

    // Construct the full path and verify it's within the songs directory
    const filePath = path.join(SONGS_DIR, sanitizedFilename);
    const resolvedPath = path.resolve(filePath);
    const resolvedSongsDir = path.resolve(SONGS_DIR);

    if (!resolvedPath.startsWith(resolvedSongsDir + path.sep) && resolvedPath !== resolvedSongsDir) {
      return res.status(400).json({ error: 'Invalid input: filename contains invalid characters.' });
    }

    // Check if file exists (CWE-209: don't leak path info)
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File does not exist.' });
    }

    // Check it's actually a file (not a directory or symlink to outside)
    const stat = fs.lstatSync(resolvedPath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'File does not exist.' });
    }

    // Set appropriate headers and stream the file
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

    const readStream = fs.createReadStream(resolvedPath);

    readStream.on('error', (err) => {
      // CWE-209: Don't expose internal error details
      if (!res.headersSent) {
        res.status(500).json({ error: 'An internal error occurred.' });
      }
    });

    readStream.pipe(res);
  } catch (err) {
    // CWE-703 & CWE-209: Handle unexpected errors without leaking info
    if (!res.headersSent) {
      res.status(500).json({ error: 'An internal error occurred.' });
    }
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});