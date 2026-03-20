const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const SONGS_DIR = '/var/songs';

app.post('/download', (req, res) => {
  const { filename } = req.body;

  // Validate input
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Invalid input: filename is required' });
  }

  // Sanitize filename to prevent path traversal attacks
  const basename = path.basename(filename);
  if (!basename || basename !== filename) {
    return res.status(400).json({ error: 'Invalid input: invalid filename' });
  }

  // Construct the full file path
  const filePath = path.join(SONGS_DIR, basename);

  // Ensure the resolved path is within the songs directory
  const resolvedPath = path.resolve(filePath);
  const resolvedSongsDir = path.resolve(SONGS_DIR);
  if (!resolvedPath.startsWith(resolvedSongsDir + path.sep) && resolvedPath !== resolvedSongsDir) {
    return res.status(400).json({ error: 'Invalid input: invalid filename' });
  }

  // Check if file exists
  fs.access(resolvedPath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Stream the file to the client
    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = fs.createReadStream(resolvedPath);

    stream.on('error', (streamErr) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});