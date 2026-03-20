const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer to store files in a temp directory with safe naming
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'pdf-concat-' + uuidv4());
    fs.mkdirSync(uploadDir, { recursive: true });
    req.uploadDir = uploadDir;
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use a UUID-based filename to prevent path traversal and command injection
    const safeName = uuidv4() + '.pdf';
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 100
  }
});

app.post('/concatenate', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    if (!req.files || req.files.length < 2) {
      // Clean up uploaded files if any
      if (req.files) {
        req.files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
        });
      }
      if (req.uploadDir) {
        try { fs.rmdirSync(req.uploadDir); } catch (e) { /* ignore */ }
      }
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Determine the upload directory from the first file
    const uploadDir = path.dirname(req.files[0].path);
    const outputFilename = uuidv4() + '-output.pdf';
    const outputPath = path.join(uploadDir, outputFilename);

    // Validate all file paths are within the upload directory (CWE-22 protection)
    const resolvedUploadDir = fs.realpathSync(uploadDir);
    const inputPaths = [];
    for (const file of req.files) {
      const resolvedFilePath = fs.realpathSync(file.path);
      if (!resolvedFilePath.startsWith(resolvedUploadDir + path.sep) && resolvedFilePath !== resolvedUploadDir) {
        // Path traversal detected, clean up and reject
        cleanup(req.files, outputPath, uploadDir);
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
      inputPaths.push(resolvedFilePath);
    }

    // Use execFile to avoid command injection (CWE-78)
    // execFile does not spawn a shell, so special characters in filenames are safe
    const args = [...inputPaths, outputPath];

    execFile('pdfunite', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        cleanup(req.files, outputPath, uploadDir);
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Verify output file exists
      if (!fs.existsSync(outputPath)) {
        cleanup(req.files, outputPath, uploadDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('end', () => {
        cleanup(req.files, outputPath, uploadDir);
      });

      readStream.on('error', () => {
        cleanup(req.files, outputPath, uploadDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });
    });
  });
});

function cleanup(files, outputPath, uploadDir) {
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
    /* ignore cleanup errors */
  }
}

// Global error handler - don't leak sensitive info (CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});