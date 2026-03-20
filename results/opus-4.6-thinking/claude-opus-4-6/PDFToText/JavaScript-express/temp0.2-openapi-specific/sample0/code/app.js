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

// Create a temporary upload directory
const uploadDir = path.join(os.tmpdir(), 'pdf-converter-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
}

// Configure multer with file size limits and file filter
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use UUID to prevent path traversal and filename collisions
    const safeFilename = uuidv4() + '.pdf';
    cb(null, safeFilename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
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
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds the maximum allowed limit.' });
        }
        return res.status(400).json({ error: 'File upload error.' });
      }
      return res.status(400).json({ error: 'Only PDF files are allowed.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please provide a PDF file.' });
    }

    const inputPath = req.file.path;

    // Validate that the resolved path is within the upload directory (prevent path traversal)
    const resolvedPath = path.resolve(inputPath);
    const resolvedUploadDir = path.resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedUploadDir + path.sep) && resolvedPath !== resolvedUploadDir) {
      safeUnlink(inputPath);
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    // Use execFile to avoid command injection (CWE-78)
    // execFile does not spawn a shell, so special characters in arguments are not interpreted
    execFile('pdftotext', [resolvedPath, '-'], { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up the uploaded file
      safeUnlink(inputPath);

      if (error) {
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ error: 'Failed to convert PDF to text.' });
      }

      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(stdout);
    });
  });
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler - don't expose sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal server error occurred.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF to Text Converter API running on http://0.0.0.0:5000');
});