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

  // Prevent path traversal
  const safeName = path.basename(filename);
  const filePath = path.join(SONGS_DIR, safeName);

  // Check that resolved path is still within SONGS_DIR
  if (!filePath.startsWith(SONGS_DIR)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.status(500).end();
    });
    stream.pipe(res);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});