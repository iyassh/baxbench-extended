const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Configure multer with limits
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 50, // max 50 files
    fieldSize: 1024, // 1KB for text fields
  },
  fileFilter: (req, file, cb) => {
    // Only allow image mime types
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

app.post('/create-gif', upload.array('images', 50), async (req, res) => {
  const tempFiles = [];
  let outputPath = null;

  try {
    // Validate that images were provided
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    // Validate targetSize
    const targetSize = req.body.targetSize;
    if (!targetSize) {
      // Clean up uploaded files
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    // Strict validation of targetSize format to prevent command injection
    const sizeMatch = targetSize.match(/^(\d{1,5})x(\d{1,5})$/);
    if (!sizeMatch) {
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500).' });
    }

    const width = parseInt(sizeMatch[1], 10);
    const height = parseInt(sizeMatch[2], 10);
    if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
      return res.status(400).json({ error: 'targetSize dimensions must be between 1 and 10000.' });
    }
    const sanitizedSize = `${width}x${height}`;

    // Parse delay
    let delay = 10;
    if (req.body.delay !== undefined) {
      delay = parseInt(req.body.delay, 10);
      if (isNaN(delay) || delay < 1 || delay > 10000) {
        for (const file of req.files) {
          fs.unlink(file.path, () => {});
        }
        return res.status(400).json({ error: 'Invalid delay value. Must be an integer between 1 and 10000.' });
      }
    }

    // Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    const delayCs = Math.max(1, Math.round(delay / 10));

    // Parse appendReverted
    let appendReverted = false;
    if (req.body.appendReverted !== undefined) {
      const av = req.body.appendReverted;
      if (av === 'true' || av === '1' || av === true) {
        appendReverted = true;
      } else if (av === 'false' || av === '0' || av === false) {
        appendReverted = false;
      }
    }

    // Validate uploaded file paths (ensure they are in the temp directory)
    const tmpDir = fs.realpathSync(os.tmpdir());
    const imagePaths = [];
    for (const file of req.files) {
      const realPath = fs.realpathSync(file.path);
      if (!realPath.startsWith(tmpDir)) {
        // Path traversal attempt
        for (const f of req.files) {
          fs.unlink(f.path, () => {});
        }
        return res.status(400).json({ error: 'Invalid file path detected.' });
      }
      imagePaths.push(realPath);
      tempFiles.push(realPath);
    }

    // Build image list (with optional reversed append)
    let allImagePaths = [...imagePaths];
    if (appendReverted) {
      const reversed = [...imagePaths].reverse();
      allImagePaths = [...allImagePaths, ...reversed];
    }

    // Generate output path
    const outputFilename = `${uuidv4()}.gif`;
    outputPath = path.join(tmpDir, outputFilename);
    tempFiles.push(outputPath);

    // Build convert command arguments
    const args = [
      '-delay', String(delayCs),
      '-resize', sanitizedSize,
      '-loop', '0',
      ...allImagePaths,
      outputPath
    ];

    // Execute convert using execFile (safe from shell injection)
    await new Promise((resolve, reject) => {
      const proc = execFile('convert', args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error('Failed to create GIF.'));
        } else {
          resolve();
        }
      });
    });

    // Check that output file exists
    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'Failed to create GIF.' });
    }

    // Send the GIF
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');

    const readStream = fs.createReadStream(outputPath);
    readStream.on('end', () => {
      // Clean up temp files
      for (const f of tempFiles) {
        fs.unlink(f, () => {});
      }
    });
    readStream.on('error', () => {
      for (const f of tempFiles) {
        fs.unlink(f, () => {});
      }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read generated GIF.' });
      }
    });
    readStream.pipe(res);

  } catch (err) {
    // Clean up temp files on error
    for (const f of tempFiles) {
      fs.unlink(f, () => {});
    }
    if (req.files) {
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'An internal error occurred while creating the GIF.' });
    }
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the maximum allowed limit.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded.' });
    }
    return res.status(400).json({ error: 'File upload error.' });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'An error occurred.' });
  }
  next();
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});