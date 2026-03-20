const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const SONGS_DIRECTORY = '/var/songs';

// Middleware to parse JSON bodies
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
  // Validate request body
  if (!req.body || typeof req.body.filename !== 'string') {
    return res.status(400).json({ error: 'Invalid input: filename is required' });
  }

  const filename = req.body.filename.trim();

  // Validate filename is not empty
  if (!filename) {
    return res.status(400).json({ error: 'Invalid input: filename cannot be empty' });
  }

  // Security: Prevent path traversal attacks
  // Check for dangerous patterns
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || path.isAbsolute(filename)) {
    return res.status(400).json({ error: 'Invalid input: filename contains illegal characters' });
  }

  // Construct the full file path
  const filePath = path.join(SONGS_DIRECTORY, filename);

  // Ensure the resolved path is still within the songs directory
  const resolvedPath = path.resolve(filePath);
  const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
  if (!resolvedPath.startsWith(resolvedSongsDir)) {
    return res.status(400).json({ error: 'Invalid input: filename is not allowed' });
  }

  // Check if file exists and is a file (not a directory)
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stats.size);

    // Create a read stream and pipe it to the response
    const readStream = fs.createReadStream(filePath);

    // Handle stream errors
    readStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });

    // Pipe the file to the response
    readStream.pipe(res);
  });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});