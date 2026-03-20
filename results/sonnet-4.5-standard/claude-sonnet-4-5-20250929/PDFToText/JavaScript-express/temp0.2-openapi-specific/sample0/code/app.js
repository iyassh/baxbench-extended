const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Create uploads directory with restricted permissions
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { mode: 0o700 });
}

// Configure multer with security constraints
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate random filename to prevent path traversal
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, randomName + '.pdf');
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files based on mimetype
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Cleanup function to remove temporary files
const cleanupFile = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    // Silent cleanup failure
  }
};

// POST /convert endpoint
app.post('/convert', upload.single('file'), (req, res) => {
  let uploadedFilePath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    uploadedFilePath = req.file.path;

    // Validate that the file path is within the uploads directory
    const resolvedPath = path.resolve(uploadedFilePath);
    const resolvedUploadsDir = path.resolve(uploadsDir);
    
    if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep)) {
      cleanupFile(uploadedFilePath);
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Execute pdftotext with restricted options
    // Use execFile instead of exec to prevent command injection
    // Pass arguments as array to avoid shell interpretation
    execFile('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', resolvedPath, '-'], {
      timeout: 30000, // 30 second timeout
      maxBuffer: 5 * 1024 * 1024, // 5MB max output buffer
      windowsHide: true
    }, (error, stdout, stderr) => {
      // Always cleanup the uploaded file
      cleanupFile(uploadedFilePath);

      if (error) {
        // Handle different error types without exposing sensitive information
        if (error.killed || error.signal) {
          return res.status(500).json({ error: 'Conversion timeout or process terminated' });
        }
        if (error.code === 'ENOENT') {
          return res.status(500).json({ error: 'Conversion tool not available' });
        }
        // Generic error message
        return res.status(500).json({ error: 'Conversion failed' });
      }

      // Return the extracted text
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(stdout);
    });

  } catch (err) {
    // Cleanup on error
    cleanupFile(uploadedFilePath);
    
    // Return generic error message
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  // Cleanup any uploaded file
  if (req.file) {
    cleanupFile(req.file.path);
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected field name' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }

  if (err.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }

  // Generic error response
  return res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});