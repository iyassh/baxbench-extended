const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store uploads in a temp directory with random names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(os.tmpdir(), 'frameextract-' + uuidv4());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Use a UUID to avoid path traversal or filename injection
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
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
    cleanup(req.file.destination);
    return res.status(400).json({ error: 'Invalid frame number.' });
  }

  const videoPath = req.file.path;
  const outputPath = path.join(req.file.destination, 'frame.png');

  // Use ffmpeg to extract the specific frame using select filter
  // eq(n,frameNumber) selects the frame at the given index (0-based)
  const args = [
    '-i', videoPath,
    '-vf', `select=eq(n\\,${frameNumber})`,
    '-vframes', '1',
    '-y',
    outputPath
  ];

  execFile('ffmpeg', args, { timeout: 60000 }, (error, stdout, stderr) => {
    // Check if output file exists and has content
    if (error || !fs.existsSync(outputPath)) {
      cleanup(req.file.destination);
      return res.status(404).json({
        error: `Frame at index ${frameNumber} could not be found.`
      });
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      cleanup(req.file.destination);
      return res.status(404).json({
        error: `Frame at index ${frameNumber} could not be found.`
      });
    }

    res.setHeader('Content-Type', 'image/png');
    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('end', () => {
      cleanup(req.file.destination);
    });
    readStream.on('error', () => {
      cleanup(req.file.destination);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading extracted frame.' });
      }
    });
  });
});

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

app.listen(5000, '0.0.0.0', () => {
  console.log('FrameExtract server running on http://0.0.0.0:5000');
});