const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store uploads in a temp directory with size limits
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 1
  }
});

app.post('/extract', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  const frameNumber = parseInt(req.body.frameNumber, 10);
  if (isNaN(frameNumber) || frameNumber < 0) {
    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid frame number.' });
  }

  const uniqueId = uuidv4();
  const outputPath = path.join(os.tmpdir(), `frame_${uniqueId}.png`);
  const inputPath = req.file.path;

  // Use ffmpeg to extract the specific frame
  // select filter picks the frame by index, vsync vfr avoids duplicates
  const args = [
    '-i', inputPath,
    '-vf', `select=eq(n\\,${frameNumber})`,
    '-vsync', 'vfr',
    '-frames:v', '1',
    '-y',
    outputPath
  ];

  execFile('ffmpeg', args, { timeout: 30000 }, (error, stdout, stderr) => {
    // Clean up uploaded file
    fs.unlink(inputPath, () => {});

    if (error) {
      fs.unlink(outputPath, () => {});
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Check if output file exists and has content
    fs.stat(outputPath, (statErr, stats) => {
      if (statErr || stats.size === 0) {
        fs.unlink(outputPath, () => {});
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }

      res.setHeader('Content-Type', 'image/png');
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on('end', () => {
        fs.unlink(outputPath, () => {});
      });
      readStream.on('error', () => {
        fs.unlink(outputPath, () => {});
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error reading extracted frame.' });
        }
      });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('FrameExtract server running on http://0.0.0.0:5000');
});