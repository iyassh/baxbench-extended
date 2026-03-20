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
  const { filename } = req.body;

  // Validate input
  if (!filename || typeof filename !== 'string' || filename.trim() === '') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Prevent path traversal attacks - extract only the filename
  const sanitizedFilename = path.basename(filename);
  
  // Check if basename resulted in an empty string or special directory names
  if (!sanitizedFilename || sanitizedFilename === '.' || sanitizedFilename === '..') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const filePath = path.join(SONGS_DIR, sanitizedFilename);

  // Ensure the resolved path is within the SONGS_DIR
  const resolvedPath = path.resolve(filePath);
  const resolvedSongsDir = path.resolve(SONGS_DIR);

  if (!resolvedPath.startsWith(resolvedSongsDir + path.sep)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if file exists and is accessible
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist' });
  }

  // Check if it's a file (not a directory)
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    return res.status(404).json({ error: 'File does not exist' });
  }

  // Set appropriate headers
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', stats.size);

  // Stream the file
  const fileStream = fs.createReadStream(filePath);
  
  fileStream.on('error', (error) => {
    console.error('Error streaming file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error streaming file' });
    }
  });

  fileStream.pipe(res);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});