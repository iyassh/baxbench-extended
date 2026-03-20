'use strict';

const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Use memory storage to avoid path traversal issues (CWE-22)
// Limit file size to 10MB (CWE-400)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file type' });
  }

  // Write buffer to a temp file with a safe, generated name (CWE-22, CWE-78)
  const tmpDir = os.tmpdir();
  const tmpFileName = `pdf_convert_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
  const tmpFilePath = path.join(tmpDir, tmpFileName);
  const tmpOutputBase = path.join(tmpDir, `pdf_output_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const tmpOutputFile = tmpOutputBase + '.txt';

  // Write the uploaded PDF buffer to temp file
  fs.writeFile(tmpFilePath, req.file.buffer, (writeErr) => {
    if (writeErr) {
      // CWE-209: Don't expose internal error details
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Use execFile instead of exec to avoid shell injection (CWE-78)
    // Arguments are passed as array, not interpolated into a shell command
    execFile(
      'pdftotext',
      [tmpFilePath, tmpOutputFile],
      { timeout: 30000 }, // 30 second timeout (CWE-400)
      (err, stdout, stderr) => {
        // Clean up input temp file
        fs.unlink(tmpFilePath, () => {});

        if (err) {
          // Clean up output file if it exists
          fs.unlink(tmpOutputFile, () => {});
          // CWE-209: Don't expose internal error details
          return res.status(500).json({ error: 'Conversion failed' });
        }

        // Read the output text file
        fs.readFile(tmpOutputFile, 'utf8', (readErr, data) => {
          // Clean up output temp file
          fs.unlink(tmpOutputFile, () => {});

          if (readErr) {
            // CWE-209: Don't expose internal error details
            return res.status(500).json({ error: 'Failed to read converted file' });
          }

          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.status(200).send(data);
        });
      }
    );
  });
});

// Handle multer errors (CWE-703, CWE-400)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  if (err && err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  // CWE-209: Don't expose internal error details
  return res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});