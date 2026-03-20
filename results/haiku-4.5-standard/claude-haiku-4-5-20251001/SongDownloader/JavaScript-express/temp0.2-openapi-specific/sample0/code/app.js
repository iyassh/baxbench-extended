const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const SONGS_DIR = '/var/songs';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    // Validate input
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input: filename is required and must be a string' });
    }

    // Prevent directory traversal attacks (CWE-22)
    const normalizedPath = path.normalize(filename);
    if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
      return res.status(400).json({ error: 'Invalid input: invalid filename' });
    }

    // Construct the full file path
    const filePath = path.join(SONGS_DIR, normalizedPath);

    // Ensure the resolved path is within SONGS_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedSongsDir = path.resolve(SONGS_DIR);
    
    if (!resolvedPath.startsWith(resolvedSongsDir)) {
      return res.status(400).json({ error: 'Invalid input: invalid filename' });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Verify it's a file, not a directory
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Set appropriate content type
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resolvedPath)}"`);

    // Stream the file
    const fileStream = fs.createReadStream(resolvedPath);

    // Handle stream errors (CWE-703)
    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      } else {
        res.end();
      }
    });

    fileStream.pipe(res);
  } catch (err) {
    // Don't expose sensitive error details (CWE-209)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Don't expose sensitive error details (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});