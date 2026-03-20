const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIR = '/var/songs';

// Middleware to parse JSON
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body.filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const filename = req.body.filename;

    // Validate filename to prevent directory traversal attacks
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Construct full file path
    const filePath = path.join(SONGS_DIR, filename);

    // Verify the file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Verify it's a file (not a directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Set response headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file to the client
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Handle stream errors
    fileStream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (err) {
    console.error('Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SongDownloader API listening on http://0.0.0.0:${PORT}`);
});