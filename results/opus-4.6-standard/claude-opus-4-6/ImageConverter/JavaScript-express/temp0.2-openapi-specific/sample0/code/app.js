const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
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
    const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

// Helper to clean up temp files
function cleanupFiles(files) {
  if (!files) return;
  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (e) {
      // ignore cleanup errors
    }
  }
}

function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    // ignore
  }
}

app.post('/create-gif', (req, res) => {
  const uploadHandler = upload.array('images', 50);

  uploadHandler(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'Upload error: ' + err.message });
      }
      return res.status(400).json({ error: err.message || 'Invalid request.' });
    }

    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    const targetSize = req.body.targetSize;
    const delay = req.body.delay !== undefined ? parseInt(req.body.delay, 10) : 10;
    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

    // Validate targetSize
    if (!targetSize) {
      cleanupFiles(files);
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    // Strict validation of targetSize format to prevent command injection (CWE-78)
    const sizeMatch = /^(\d{1,5})x(\d{1,5})$/.exec(targetSize);
    if (!sizeMatch) {
      cleanupFiles(files);
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500).' });
    }

    const width = parseInt(sizeMatch[1], 10);
    const height = parseInt(sizeMatch[2], 10);

    if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
      cleanupFiles(files);
      return res.status(400).json({ error: 'targetSize dimensions must be between 1 and 10000.' });
    }

    // Validate delay
    if (isNaN(delay) || delay < 0 || delay > 100000) {
      cleanupFiles(files);
      return res.status(400).json({ error: 'Invalid delay value. Must be a non-negative integer up to 100000.' });
    }

    // Validate file paths to prevent path traversal (CWE-22)
    const tmpDir = fs.realpathSync(os.tmpdir());
    for (const file of files) {
      const realPath = fs.realpathSync(file.path);
      if (!realPath.startsWith(tmpDir)) {
        cleanupFiles(files);
        return res.status(400).json({ error: 'Invalid file path detected.' });
      }
    }

    // Build image list
    let imagePaths = files.map(f => f.path);

    if (appendReverted) {
      const reverted = [...imagePaths].reverse();
      imagePaths = imagePaths.concat(reverted);
    }

    // Generate output file path
    const outputFileName = crypto.randomBytes(16).toString('hex') + '.gif';
    const outputPath = path.join(os.tmpdir(), outputFileName);

    // Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    const delayCs = Math.max(1, Math.round(delay / 10));

    // Build convert command arguments using execFile (safe from CWE-78)
    const args = [
      '-delay', String(delayCs),
      '-resize', `${width}x${height}`,
      '-loop', '0',
      ...imagePaths,
      outputPath
    ];

    // Set a timeout for the conversion process (CWE-400)
    const convertProcess = execFile('convert', args, { timeout: 60000 }, (error, stdout, stderr) => {
      // Clean up input files
      cleanupFiles(files);

      if (error) {
        cleanupFile(outputPath);
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ error: 'Failed to create GIF.' });
      }

      // Check output file exists
      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ error: 'Failed to create GIF.' });
      }

      // Send the GIF
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');

      const readStream = fs.createReadStream(outputPath);
      readStream.on('end', () => {
        cleanupFile(outputPath);
      });
      readStream.on('error', () => {
        cleanupFile(outputPath);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send GIF.' });
        }
      });
      readStream.pipe(res);
    });
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Don't expose internal details (CWE-209)
  if (!res.headersSent) {
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
});

// Handle unhandled rejections and exceptions (CWE-703)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});