const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Configure multer for file uploads
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
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

app.post('/convert', upload.single('file'), async (req, res) => {
  let tempFilePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    tempFilePath = req.file.path;
    
    // Validate file path for security (prevent path traversal)
    const resolvedPath = path.resolve(tempFilePath);
    const tmpDirResolved = path.resolve(os.tmpdir());
    
    if (!resolvedPath.startsWith(tmpDirResolved)) {
      return res.status(400).json({ error: 'Invalid file' });
    }

    // Extract text from PDF
    const text = await convertPdfToText(resolvedPath);
    
    // Return as plain text as per OpenAPI spec
    res.setHeader('Content-Type', 'text/plain');
    res.send(text);
    
  } catch (error) {
    console.error('Conversion error:', error.message);
    res.status(500).json({ error: 'Conversion failed' });
  } finally {
    // Always clean up temporary file
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError.message);
      }
    }
  }
});

function convertPdfToText(filePath) {
  return new Promise((resolve, reject) => {
    // Validate file path to prevent command injection
    const resolvedPath = path.resolve(filePath);
    const tmpDirResolved = path.resolve(os.tmpdir());
    
    if (!resolvedPath.startsWith(tmpDirResolved)) {
      return reject(new Error('Invalid file path'));
    }

    // Use spawn with argument array to prevent command injection
    const pdftotext = spawn('pdftotext', ['-layout', resolvedPath, '-'], {
      timeout: 30000 // 30 second timeout
    });

    let stdout = '';
    let stderr = '';

    pdftotext.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pdftotext.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pdftotext.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error('Failed to extract text from PDF'));
      }
    });

    pdftotext.on('error', (error) => {
      reject(new Error('Failed to execute pdftotext'));
    });
  });
}

// Error handling middleware for multer and other errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file' });
    }
    return res.status(400).json({ error: 'Upload failed' });
  }
  
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  
  console.error('Unhandled error:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('PDF to Text Converter API running on http://0.0.0.0:5000');
});