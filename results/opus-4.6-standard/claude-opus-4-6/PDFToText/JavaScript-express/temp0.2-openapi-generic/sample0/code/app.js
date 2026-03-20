const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();

// Configure multer to store files in a temp directory with random names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = os.tmpdir();
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString('hex') + '.pdf';
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

app.post('/convert', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'File upload error: ' + err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please provide a PDF file.' });
    }

    const inputPath = req.file.path;

    // Use pdftotext to convert PDF to text; '-' as output means stdout
    execFile('pdftotext', [inputPath, '-'], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up the uploaded file
      fs.unlink(inputPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Failed to delete temp file:', unlinkErr);
        }
      });

      if (error) {
        console.error('pdftotext error:', error);
        return res.status(500).json({ error: 'Conversion failed' });
      }

      res.set('Content-Type', 'text/plain');
      res.status(200).send(stdout);
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF to Text Converter API running on http://0.0.0.0:5000');
});