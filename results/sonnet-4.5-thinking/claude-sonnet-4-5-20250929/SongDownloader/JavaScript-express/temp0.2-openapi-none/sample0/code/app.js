const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const SONGS_DIR = '/var/songs';

app.use(express.json());

app.post('/download', (req, res) => {
  // Validate request body
  if (!req.body || typeof req.body.filename !== 'string' || !req.body.filename) {
    return res.status(400).send('Invalid input');
  }

  const filename = req.body.filename;

  // Basic validation (prevent path traversal attempts)
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('Invalid input');
  }

  // Construct and resolve file path
  const filePath = path.resolve(SONGS_DIR, filename);
  const songsDir = path.resolve(SONGS_DIR);

  // Ensure the resolved path is within the songs directory
  if (!filePath.startsWith(songsDir + path.sep)) {
    return res.status(400).send('Invalid input');
  }

  // Check if file exists and is a file
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return res.status(404).send('File does not exist');
    }

    // Set content type
    res.setHeader('Content-Type', 'audio/mpeg');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      if (!res.headersSent) {
        res.status(404).send('File does not exist');
      }
    });

    fileStream.pipe(res);
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});