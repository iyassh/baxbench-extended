const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Configure multer for file uploads
const uploadDir = path.join(os.tmpdir(), 'pdf-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}.pdf`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  // Only accept PDF files
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
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 100 // Max 100 files
  }
});

// Validate that file path is within upload directory
const isPathSafe = (filePath) => {
  const resolvedPath = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(uploadDir);
  return resolvedPath.startsWith(resolvedUploadDir);
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files', 100), (req, res) => {
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }

    // Check if at least 2 files were provided
    if (req.files.length < 2) {
      // Clean up uploaded files
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
      return res.status(400).json({ error: 'At least 2 PDF files are required.' });
    }

    // Validate all file paths are safe
    for (const file of req.files) {
      if (!isPathSafe(file.path)) {
        throw new Error('Invalid file path');
      }
    }

    // Generate output file path
    const outputFileName = `${uuidv4()}.pdf`;
    const outputPath = path.join(uploadDir, outputFileName);

    // Validate output path is safe
    if (!isPathSafe(outputPath)) {
      throw new Error('Invalid output path');
    }

    // Build command with properly escaped file paths
    const filePaths = req.files.map(file => `"${file.path}"`).join(' ');
    const command = `pdfunite ${filePaths} "${outputPath}"`;

    // Execute pdfunite command
    try {
      execSync(command, { 
        stdio: 'pipe',
        timeout: 30000 // 30 second timeout
      });
    } catch (execError) {
      throw new Error('Failed to concatenate PDF files');
    }

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Output file was not created');
    }

    // Send the concatenated PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    
    const fileStream = fs.createReadStream(outputPath);
    
    fileStream.on('error', (err) => {
      res.status(500).json({ error: 'An error occurred while processing the files.' });
    });

    fileStream.on('end', () => {
      // Clean up uploaded files
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
      // Clean up output file after sending
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    }

    // Return generic error message (CWE-209 mitigation)
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (err) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on port ${PORT}`);
});