const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIR = '/var/songs';

app.use(express.json());

app.post('/download', (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body.filename !== 'string' || !req.body.filename.trim()) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const filename = req.body.filename.trim();
    
    // Sanitize filename to prevent directory traversal attacks
    const safePath = path.join(SONGS_DIR, path.basename(filename));
    
    // Check if file exists and is a file (not a directory)
    let stat;
    try {
      stat = fs.statSync(safePath);
    } catch (err) {
      return res.status(404).json({ error: 'File does not exist' });
    }
    
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Set content type for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    
    // Create read stream and pipe to response
    const readStream = fs.createReadStream(safePath);
    
    readStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(404).json({ error: 'File does not exist' });
      }
    });
    
    readStream.pipe(res);
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(400).json({ error: 'Invalid input' });
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});