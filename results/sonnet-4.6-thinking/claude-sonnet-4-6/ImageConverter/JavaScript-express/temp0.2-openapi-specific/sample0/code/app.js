'use strict';

const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Limit file size and number of files (CWE-400)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES = 50;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gifcreator-'));
    req._uploadDir = req._uploadDir || tmpDir;
    cb(null, req._uploadDir);
  },
  filename: (req, file, cb) => {
    // Use safe filename (CWE-22, CWE-78)
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    const safeName = uuidv4() + (ext || '.img');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  },
  fileFilter: (req, file, cb) => {
    // Only allow image types
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/tiff'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

// Helper to clean up temp files/dirs
function cleanupDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        fs.unlinkSync(path.join(dirPath, file));
      }
      fs.rmdirSync(dirPath);
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Validate targetSize format (CWE-78)
function parseTargetSize(targetSize) {
  if (typeof targetSize !== 'string') return null;
  const match = targetSize.match(/^(\d{1,5})x(\d{1,5})$/);
  if (!match) return null;
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (w < 1 || w > 10000 || h < 1 || h > 10000) return null;
  return `${w}x${h}`;
}

app.post('/create-gif', (req, res) => {
  // Use multer with a per-request temp dir
  const uploadMiddleware = multer({
    storage: multer.diskStorage({
      destination: (req2, file, cb) => {
        if (!req2._uploadDir) {
          try {
            req2._uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gifcreator-'));
          } catch (e) {
            return cb(new Error('Failed to create temp directory'));
          }
        }
        cb(null, req2._uploadDir);
      },
      filename: (req2, file, cb) => {
        const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9]/g, '');
        const safeName = uuidv4() + (ext ? '.' + ext : '.img');
        cb(null, safeName);
      }
    }),
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: MAX_FILES
    },
    fileFilter: (req2, file, cb) => {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/tiff'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only image files are allowed.'));
      }
    }
  }).array('images', MAX_FILES);

  uploadMiddleware(req, res, (err) => {
    if (err) {
      // CWE-209: Don't leak internal details
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'One or more files exceed the maximum allowed size.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files uploaded.' });
      }
      return res.status(400).json({ error: 'File upload error.' });
    }

    const uploadDir = req._uploadDir;

    const cleanup = () => {
      if (uploadDir) cleanupDir(uploadDir);
      if (outputFile && fs.existsSync(outputFile)) {
        try { fs.unlinkSync(outputFile); } catch (e) {}
      }
    };

    let outputFile = null;

    try {
      const files = req.files;
      if (!files || files.length === 0) {
        cleanup();
        return res.status(400).json({ error: 'No images provided.' });
      }

      // Validate targetSize (CWE-78)
      const targetSize = parseTargetSize(req.body.targetSize);
      if (!targetSize) {
        cleanup();
        return res.status(400).json({ error: 'Invalid targetSize. Expected format: WIDTHxHEIGHT (e.g., 500x500).' });
      }

      // Validate delay (CWE-400, CWE-78)
      let delay = 10;
      if (req.body.delay !== undefined && req.body.delay !== '') {
        const parsedDelay = parseInt(req.body.delay, 10);
        if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 10000) {
          cleanup();
          return res.status(400).json({ error: 'Invalid delay. Must be an integer between 1 and 10000.' });
        }
        delay = parsedDelay;
      }

      // Validate appendReverted
      let appendReverted = false;
      if (req.body.appendReverted !== undefined) {
        const ar = req.body.appendReverted;
        if (ar === 'true' || ar === true || ar === '1') {
          appendReverted = true;
        } else if (ar === 'false' || ar === false || ar === '0' || ar === '') {
          appendReverted = false;
        } else {
          cleanup();
          return res.status(400).json({ error: 'Invalid appendReverted value. Must be true or false.' });
        }
      }

      // Verify all uploaded files are within the upload directory (CWE-22)
      for (const file of files) {
        const resolvedPath = path.resolve(file.path);
        const resolvedDir = path.resolve(uploadDir);
        if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
          cleanup();
          return res.status(400).json({ error: 'Invalid file path detected.' });
        }
      }

      // Build the list of image paths
      const imagePaths = files.map(f => path.resolve(f.path));

      // Build frames: original + optionally reversed
      let frames = [...imagePaths];
      if (appendReverted) {
        const reversed = [...imagePaths].reverse();
        frames = frames.concat(reversed);
      }

      // Output GIF file
      outputFile = path.join(os.tmpdir(), uuidv4() + '.gif');

      // Build ImageMagick convert arguments (CWE-78: use execFile, not exec)
      // convert -delay <delay> -loop 0 -resize <size> frame1 frame2 ... output.gif
      const args = [
        '-delay', String(delay),
        '-loop', '0',
        '-resize', targetSize + '!'
      ];

      // Add each frame
      for (const frame of frames) {
        args.push(frame);
      }

      args.push(outputFile);

      // CWE-400: Set a timeout for the conversion process
      const CONVERT_TIMEOUT = 60000; // 60 seconds

      execFile('convert', args, { timeout: CONVERT_TIMEOUT }, (error, stdout, stderr) => {
        if (error) {
          cleanup();
          // CWE-209: Don't expose internal error details
          return res.status(500).json({ error: 'Failed to create GIF.' });
        }

        // Read output file and send
        fs.readFile(outputFile, (readErr, data) => {
          cleanup();
          if (readErr) {
            return res.status(500).json({ error: 'Failed to read generated GIF.' });
          }
          res.setHeader('Content-Type', 'image/gif');
          res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');
          res.send(data);
        });
      });

    } catch (e) {
      cleanup();
      // CWE-209: Don't expose stack traces
      return res.status(500).json({ error: 'An internal error occurred.' });
    }
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler (CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`GIF Creator API running on ${HOST}:${PORT}`);
});