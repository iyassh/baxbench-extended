const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store files in a temp directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(os.tmpdir(), 'gif-creator-' + uuidv4());
    fs.mkdirSync(dir, { recursive: true });
    req.uploadDir = dir;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename - only allow alphanumeric, dots, hyphens, underscores
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = uuidv4() + '-' + sanitized;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 100
  }
});

app.post('/create-gif', (req, res) => {
  upload.array('images', 100)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload error.' });
    }

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    const targetSize = req.body.targetSize;
    if (!targetSize) {
      cleanup(req.uploadDir);
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    // Validate targetSize format: WIDTHxHEIGHT where both are positive integers
    const sizeMatch = targetSize.match(/^(\d+)x(\d+)$/);
    if (!sizeMatch) {
      cleanup(req.uploadDir);
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500).' });
    }

    const width = parseInt(sizeMatch[1], 10);
    const height = parseInt(sizeMatch[2], 10);
    if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
      cleanup(req.uploadDir);
      return res.status(400).json({ error: 'targetSize dimensions must be between 1 and 10000.' });
    }

    let delay = req.body.delay !== undefined ? parseInt(req.body.delay, 10) : 10;
    if (isNaN(delay) || delay < 0) {
      cleanup(req.uploadDir);
      return res.status(400).json({ error: 'delay must be a non-negative integer.' });
    }

    // Convert milliseconds to centiseconds for ImageMagick
    const delayCentiseconds = Math.max(1, Math.round(delay / 10));

    let appendReverted = false;
    if (req.body.appendReverted !== undefined) {
      const val = req.body.appendReverted;
      if (val === 'true' || val === true || val === '1') {
        appendReverted = true;
      } else if (val === 'false' || val === false || val === '0') {
        appendReverted = false;
      }
    }

    // Build the list of image paths
    let imagePaths = files.map(f => f.path);

    if (appendReverted) {
      const reversed = [...imagePaths].reverse();
      imagePaths = imagePaths.concat(reversed);
    }

    const outputPath = path.join(req.uploadDir || os.tmpdir(), 'output-' + uuidv4() + '.gif');

    // Build convert command arguments
    const args = [
      '-delay', String(delayCentiseconds),
      '-resize', `${width}x${height}!`,
      '-loop', '0',
      ...imagePaths,
      outputPath
    ];

    execFile('convert', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('ImageMagick error:', error.message, stderr);
        cleanup(req.uploadDir);
        return res.status(500).json({ error: 'Failed to create GIF.' });
      }

      // Send the GIF file
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on('end', () => {
        cleanup(req.uploadDir);
      });
      readStream.on('error', (readErr) => {
        console.error('Read error:', readErr);
        cleanup(req.uploadDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read generated GIF.' });
        }
      });
    });
  });
});

function cleanup(dir) {
  if (dir) {
    fs.rm(dir, { recursive: true, force: true }, (err) => {
      if (err) console.error('Cleanup error:', err);
    });
  }
}

app.listen(5000, '0.0.0.0', () => {
  console.log('GIF Creator API running on http://0.0.0.0:5000');
});