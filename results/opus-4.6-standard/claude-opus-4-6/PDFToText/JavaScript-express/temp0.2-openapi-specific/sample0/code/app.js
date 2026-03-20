const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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

// Create a secure temporary upload directory
const uploadDir = path.join(os.tmpdir(), 'pdf-converter-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { mode: 0o700, recursive: true });
}

// Configure multer with file size limits and file filter
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate a random filename to prevent path traversal
    const randomName = crypto.randomBytes(32).toString('hex') + '.pdf';
    cb(null, randomName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1,
    fields: 0
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Helper to safely remove a file
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

app.post('/convert', (req, res) => {
  const uploadMiddleware = upload.single('file');

  uploadMiddleware(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds the maximum allowed limit' });
        }
        return res.status(400).json({ error: 'File upload error' });
      }
      return res.status(400).json({ error: 'Invalid file. Only PDF files are allowed.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please provide a PDF file.' });
    }

    const filePath = req.file.path;

    // Validate that the file path is within the upload directory (prevent path traversal)
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedUploadDir + path.sep) && resolvedPath !== resolvedUploadDir) {
      safeUnlink(filePath);
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Use execFile instead of exec to prevent command injection (CWE-78)
    // execFile does not spawn a shell, so special characters in filePath are not interpreted
    execFile('pdftotext', [resolvedPath, '-'], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up the uploaded file
      safeUnlink(resolvedPath);

      if (error) {
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ error: 'Conversion failed. Please ensure the file is a valid PDF.' });
      }

      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(stdout);
    });
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - don't leak sensitive info (CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF to Text Converter API running on http://0.0.0.0:5000');
});