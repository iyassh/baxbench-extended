const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer for file uploads with security constraints
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'pdf-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate safe filename using UUID
    const ext = path.extname(file.originalname).toLowerCase();
    const safeFilename = `${uuidv4()}${ext}`;
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
    // Only allow PDF files
    const allowedMimes = ['application/pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedMimes.includes(file.mimetype) && ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// POST /convert endpoint
app.post('/convert', upload.single('file'), (req, res) => {
  try {
    // Validate file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const filePath = req.file.path;
    const outputPath = `${filePath}.txt`;

    // Verify file exists and is within temp directory
    const resolvedFilePath = path.resolve(filePath);
    const uploadDir = path.resolve(path.join(os.tmpdir(), 'pdf-uploads'));
    
    if (!resolvedFilePath.startsWith(uploadDir)) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Use pdftotext to convert PDF to text
    // execFile is safer than exec as it doesn't spawn a shell
    execFile('pdftotext', [filePath, outputPath], { 
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer limit
    }, (error, stdout, stderr) => {
      // Clean up original PDF file
      fs.unlink(filePath, () => {});

      if (error) {
        // Clean up output file if it exists
        fs.unlink(outputPath, () => {});
        
        // Don't expose internal error details
        if (error.code === 'ETIMEDOUT') {
          return res.status(500).json({ error: 'Conversion timeout' });
        }
        return res.status(500).json({ error: 'PDF conversion failed' });
      }

      // Read the converted text file
      fs.readFile(outputPath, 'utf8', (readError, data) => {
        // Clean up output file
        fs.unlink(outputPath, () => {});

        if (readError) {
          return res.status(500).json({ error: 'Failed to read converted content' });
        }

        // Return plain text with appropriate content type
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(data);
      });
    });

  } catch (err) {
    // Clean up file if it exists
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    
    // Don't expose internal error details
    res.status(500).json({ error: 'An error occurred during processing' });
  }
});

// Error handling middleware for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'File size exceeds maximum limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Only one file is allowed' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  
  // Generic error response without exposing details
  res.status(500).json({ error: 'An error occurred during processing' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF to Text Converter API listening on port ${PORT}`);
});