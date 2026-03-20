const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Middleware to parse JSON
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body.filename !== 'string') {
      return res.status(400).send('Invalid input');
    }

    const filename = req.body.filename.trim();
    
    // Validate filename
    if (!filename || filename.length > 255) {
      return res.status(400).send('Invalid input');
    }

    // Check for null bytes
    if (filename.includes('\0')) {
      return res.status(400).send('Invalid input');
    }

    // Security: Prevent path traversal attacks
    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename) {
      return res.status(400).send('Invalid input');
    }

    const filePath = path.join(SONGS_DIRECTORY, sanitizedFilename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File does not exist');
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return res.status(404).send('File does not exist');
    }

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stats.size);

    // Create read stream and pipe to response
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).send('Internal server error');
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).send('Internal server error');
    }
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});