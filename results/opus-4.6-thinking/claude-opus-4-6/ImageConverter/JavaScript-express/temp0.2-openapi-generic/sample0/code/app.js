const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store files in a temporary directory
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
  // Only allow image files
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
  upload.array('images')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    // Validate targetSize
    const targetSize = req.body.targetSize;
    if (!targetSize) {
      cleanupFiles(req.files, req.uploadDir);
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    // Validate targetSize format (e.g., 500x500)
    const sizeRegex = /^(\d{1,5})x(\d{1,5})$/;
    const sizeMatch = targetSize.match(sizeRegex);
    if (!sizeMatch) {
      cleanupFiles(req.files, req.uploadDir);
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500).' });
    }

    const width = parseInt(sizeMatch[1], 10);
    const height = parseInt(sizeMatch[2], 10);

    if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
      cleanupFiles(req.files, req.uploadDir);
      return res.status(400).json({ error: 'targetSize dimensions must be between 1 and 10000.' });
    }

    // Parse delay
    let delay = 10; // default
    if (req.body.delay !== undefined && req.body.delay !== '') {
      delay = parseInt(req.body.delay, 10);
      if (isNaN(delay) || delay < 0) {
        cleanupFiles(req.files, req.uploadDir);
        return res.status(400).json({ error: 'delay must be a non-negative integer.' });
      }
    }

    // ImageMagick uses delay in 1/100th of a second
    const imDelay = Math.round(delay / 10);

    // Parse appendReverted
    let appendReverted = false;
    if (req.body.appendReverted !== undefined) {
      const val = req.body.appendReverted;
      if (val === 'true' || val === '1' || val === true) {
        appendReverted = true;
      } else if (val === 'false' || val === '0' || val === false) {
        appendReverted = false;
      }
    }

    // Build list of image paths
    let imagePaths = req.files.map(f => f.path);

    if (appendReverted) {
      const reversed = [...imagePaths].reverse();
      imagePaths = imagePaths.concat(reversed);
    }

    // Build ImageMagick convert command
    const outputPath = path.join(req.uploadDir || os.tmpdir(), 'output-' + uuidv4() + '.gif');

    const args = [
      '-delay', String(imDelay),
      '-resize', `${width}x${height}!`,
      '-loop', '0',
      ...imagePaths,
      outputPath
    ];

    execFile('convert', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('ImageMagick error:', error.message, stderr);
        cleanupFiles(req.files, req.uploadDir, outputPath);
        return res.status(500).json({ error: 'Failed to create GIF.' });
      }

      // Send the GIF file
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('end', () => {
        cleanupFiles(req.files, req.uploadDir, outputPath);
      });

      readStream.on('error', (readErr) => {
        console.error('Read stream error:', readErr);
        cleanupFiles(req.files, req.uploadDir, outputPath);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read generated GIF.' });
        }
      });
    });
  });
});

function cleanupFiles(files, uploadDir, outputPath) {
  try {
    if (files) {
      files.forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
      });
    }
    if (outputPath) {
      try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
    }
    if (uploadDir) {
      try { fs.rmdirSync(uploadDir); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    // ignore cleanup errors
  }
}

app.listen(5000, '0.0.0.0', () => {
  console.log('GIF Creator API running on http://0.0.0.0:5000');
});