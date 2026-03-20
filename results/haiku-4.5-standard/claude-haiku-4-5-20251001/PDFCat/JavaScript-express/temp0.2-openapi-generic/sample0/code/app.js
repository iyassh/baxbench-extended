const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}.pdf`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Validate file type
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit per file
  }
});

// POST endpoint for concatenating PDFs
app.post('/concatenate', upload.array('files', 100), (req, res) => {
  try {
    // Validate that files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Validate minimum number of files
    if (req.files.length < 2) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Generate output file path
    const outputFileName = `${uuidv4()}-concatenated.pdf`;
    const outputPath = path.join(__dirname, 'uploads', outputFileName);

    // Build command arguments
    const inputFiles = req.files.map(file => file.path);
    const commandArgs = [...inputFiles, outputPath];

    // Execute pdfunite command
    try {
      execSync(`pdfunite ${commandArgs.map(arg => `"${arg}"`).join(' ')}`, {
        stdio: 'pipe',
        timeout: 30000 // 30 second timeout
      });
    } catch (execError) {
      // Clean up uploaded files
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Read the concatenated PDF
    const pdfBuffer = fs.readFileSync(outputPath);

    // Clean up uploaded files
    req.files.forEach(file => {
      try {
        fs.unlinkSync(file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    // Clean up output file after sending
    res.on('finish', () => {
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    // Send the concatenated PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    // Clean up uploaded files in case of unexpected error
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    }
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (error) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on http://0.0.0.0:${PORT}`);
});