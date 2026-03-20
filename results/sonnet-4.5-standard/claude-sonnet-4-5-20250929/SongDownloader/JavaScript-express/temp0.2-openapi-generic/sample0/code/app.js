const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const SONGS_DIRECTORY = '/var/songs';

app.use(express.json());

app.post('/download', (req, res) => {
  try {
    const { filename } = req.body;

    // Validate input
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Prevent directory traversal attacks
    const normalizedFilename = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(SONGS_DIRECTORY, normalizedFilename);

    // Ensure the resolved path is still within the songs directory
    if (!filePath.startsWith(SONGS_DIRECTORY)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    // Check if it's a file (not a directory)
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);

    // Create read stream and pipe to response
    const readStream = fs.createReadStream(filePath);

    readStream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });

    readStream.pipe(res);

  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});