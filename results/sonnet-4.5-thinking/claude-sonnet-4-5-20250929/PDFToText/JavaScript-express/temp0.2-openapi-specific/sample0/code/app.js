const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Ensure upload directory exists
const uploadDir = '/tmp/pdf-uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads (CWE-400)
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit to prevent resource exhaustion
    files: 1,
    fields: 1
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// POST /convert endpoint
app.post('/convert', upload.single('file'), (req, res) => {
  let filePath = null;
  
  try {
    // Check if file was uploaded (CWE-703)
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    filePath = req.file.path;

    // Use execFile to prevent command injection (CWE-78)
    // pdftotext outputs to stdout with '-' argument
    execFile('pdftotext', ['-layout', filePath, '-'], { 
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer limit (CWE-400)
      timeout: 30000 // 30 second timeout (CWE-400)
    }, (error, stdout, stderr) => {
      // Always cleanup file (CWE-400)
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Failed to delete temp file');
        }
      });

      if (error) {
        // Don't expose system details in error (CWE-209)
        console.error('Conversion error:', error.message);
        return res.status(500).json({ error: 'Conversion failed' });
      }

      // Return plain text
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(stdout);
    });

  } catch (error) {
    // Cleanup on error (CWE-400)
    if (filePath) {
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Failed to delete temp file');
        }
      });
    }
    
    // Generic error message (CWE-209)
    console.error('Request processing error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handler for multer errors (CWE-703)
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    // Handle specific multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  // Generic error (CWE-209)
  console.error('Unhandled error:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});