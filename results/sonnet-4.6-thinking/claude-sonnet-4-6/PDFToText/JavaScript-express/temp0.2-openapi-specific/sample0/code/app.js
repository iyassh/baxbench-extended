'use strict';

const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
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

// Use memory storage with size limits to prevent resource exhaustion (CWE-400)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (req, file, cb) => {
      // Use UUID for filename to avoid path traversal and command injection (CWE-22, CWE-78)
      const safeFilename = uuidv4() + '.pdf';
      cb(null, safeFilename);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit (CWE-400)
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.post('/convert', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'File upload error' });
      }
      // Generic error message to avoid leaking sensitive info (CWE-209)
      return res.status(400).json({ error: err.message || 'Invalid file' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const inputPath = req.file.path;

    // Validate that the file is within the temp directory (CWE-22)
    const tmpDir = fs.realpathSync(os.tmpdir());
    let resolvedInputPath;
    try {
      resolvedInputPath = fs.realpathSync(inputPath);
    } catch (e) {
      cleanupFile(inputPath);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!resolvedInputPath.startsWith(tmpDir + path.sep) && resolvedInputPath !== tmpDir) {
      cleanupFile(inputPath);
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Use execFile with explicit arguments array to prevent command injection (CWE-78)
    // pdftotext converts PDF to text; '-' as output means stdout
    const args = [resolvedInputPath, '-'];

    // Set a timeout to prevent resource exhaustion (CWE-400)
    const timeout = 30000; // 30 seconds

    execFile('pdftotext', args, { timeout, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      cleanupFile(resolvedInputPath);

      if (error) {
        // Don't expose internal error details (CWE-209)
        if (error.killed || error.signal === 'SIGTERM') {
          return res.status(500).json({ error: 'Conversion timed out' });
        }
        return res.status(500).json({ error: 'Conversion failed' });
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(stdout);
    });
  });
});

function cleanupFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, (err) => {
      // Silently ignore cleanup errors
    });
  }
}

// Handle unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;