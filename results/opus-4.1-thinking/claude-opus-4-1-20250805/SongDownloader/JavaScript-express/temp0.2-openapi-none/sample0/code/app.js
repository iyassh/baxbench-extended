const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIR = '/var/songs';

// Middleware to parse JSON bodies
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
  // Validate request body
  if (!req.body || !req.body.filename) {
    return res.status(400).json({ error: 'Invalid input: filename is required' });
  }

  const filename = req.body.filename;

  // Validate filename (prevent path traversal)
  if (typeof filename !== 'string' || filename.includes('..') || path.isAbsolute(filename)) {
    return res.status(400).json({ error: 'Invalid input: invalid filename' });
  }

  // Construct the full file path
  const filePath = path.join(SONGS_DIR, filename);

  // Check if file exists and is within the songs directory
  if (!filePath.startsWith(SONGS_DIR)) {
    return res.status(400).json({ error: 'Invalid input: invalid filename' });
  }

  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Check if it's a file (not a directory)
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        return res.status(404).json({ error: 'File does not exist' });
      }

      // Set appropriate headers for audio streaming
      res.setHeader('Content-Type', 'audio/mpeg');
      
      // Create a read stream and pipe it to the response
      const stream = fs.createReadStream(filePath);
      
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });

      stream.pipe(res);
    });
  });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});