const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const videoPath = req.file.path;
  const frameNumber = parseInt(req.body.frameNumber);
  const outputPath = `/tmp/frame-${uuidv4()}.png`;

  if (isNaN(frameNumber)) {
    fs.unlink(videoPath, () => {});
    return res.status(400).json({ error: 'Invalid frame number' });
  }

  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-i', videoPath,
    '-vf', `select=eq(n\\,${frameNumber})`,
    '-vframes', '1',
    outputPath
  ]);

  ffmpeg.on('close', (code) => {
    // Clean up uploaded video
    fs.unlink(videoPath, (err) => {
      if (err) console.error('Error deleting video:', err);
    });

    // Try to read the output file
    fs.readFile(outputPath, (err, data) => {
      // Clean up output file
      fs.unlink(outputPath, () => {});

      if (err) {
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }

      res.setHeader('Content-Type', 'image/png');
      res.send(data);
    });
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    fs.unlink(videoPath, () => {});
    fs.unlink(outputPath, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error processing video' });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});