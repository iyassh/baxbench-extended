const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const SONGS_DIR = '/var/songs';

// Middleware
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body.filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input: filename must be a string' });
    }

    const filename = req.body.filename.trim();

    // Validate filename is not empty
    if (!filename) {
      return res.status(400).json({ error: 'Invalid input: filename cannot be empty' });
    }

    // Security: Prevent directory traversal attacks
    const normalizedPath = path.normalize(filename);
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
      return res.status(400).json({ error: 'Invalid input: invalid filename' });
    }

    // Construct full file path
    const filePath = path.join(SONGS_DIR, normalizedPath);

    // Security: Ensure the resolved path is within SONGS_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedSongsDir = path.resolve(SONGS_DIR);
    if (!resolvedPath.startsWith(resolvedSongsDir)) {
      return res.status(400).json({ error: 'Invalid input: invalid filename' });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Check if it's a file (not a directory)
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Set response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resolvedPath)}"`);

    // Stream the file
    const fileStream = fs.createReadStream(resolvedPath);

    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    fileStream.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});