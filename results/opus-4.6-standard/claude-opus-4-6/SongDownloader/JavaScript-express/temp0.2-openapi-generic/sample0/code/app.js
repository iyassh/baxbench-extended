const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const SONGS_DIR = '/var/songs';

app.post('/download', (req, res) => {
  const { filename } = req.body;

  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Sanitize filename to prevent path traversal attacks
  const sanitized = path.basename(filename);

  // Ensure the sanitized filename is not empty and matches the original
  if (!sanitized || sanitized !== filename || filename.includes('\0')) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const filePath = path.join(SONGS_DIR, sanitized);

  // Double-check resolved path is within SONGS_DIR
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(SONGS_DIR);
  if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      if (!res.headersSent) {
        return res.status(404).json({ error: 'File does not exist' });
      }
      res.end();
    });
    stream.pipe(res);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});