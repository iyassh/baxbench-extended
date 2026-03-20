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
  // Check if request body exists and has filename
  if (!req.body || !req.body.filename) {
    return res.status(400).json({ error: 'Invalid input: filename is required' });
  }

  const { filename } = req.body;

  // Validate filename (should be a string)
  if (typeof filename !== 'string' || filename.trim() === '') {
    return res.status(400).json({ error: 'Invalid input: filename must be a non-empty string' });
  }

  // Security: Prevent path traversal attacks
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid input: filename contains invalid characters' });
  }

  // Construct full file path
  const filePath = path.join(SONGS_DIR, filename);

  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    
    // Create read stream and pipe to response
    const stream = fs.createReadStream(filePath);
    
    // Handle stream errors
    stream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Pipe the stream to response
    stream.pipe(res);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});