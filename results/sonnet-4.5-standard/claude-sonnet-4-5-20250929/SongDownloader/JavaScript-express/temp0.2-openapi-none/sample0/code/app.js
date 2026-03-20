const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const SONGS_DIR = '/var/songs';

app.use(express.json());

app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename || typeof filename !== 'string') {
      return res.status(400).send('Invalid input');
    }

    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(SONGS_DIR, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File does not exist');
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return res.status(404).send('File does not exist');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(filePath);

    readStream.on('error', (err) => {
      console.error('Error reading file:', err);
      if (!res.headersSent) {
        res.status(500).send('Error streaming file');
      }
    });

    readStream.pipe(res);

  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal server error');
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});