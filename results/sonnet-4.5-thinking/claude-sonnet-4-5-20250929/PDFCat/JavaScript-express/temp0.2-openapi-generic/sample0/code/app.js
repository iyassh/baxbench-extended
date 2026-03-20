const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Configure multer for file upload
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 20 // max 20 files
  },
  fileFilter: (req, file, cb) => {
    // Check if the file is a PDF
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Utility function to clean up files
const cleanupFiles = (files) => {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error(`Error deleting file ${file}:`, err);
    }
  });
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), (req, res) => {
  const uploadedFiles = req.files;
  const tempFiles = [];

  try {
    // Validate that files were uploaded
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Validate minimum number of files (pdfunite requires at least 2 input files)
    if (uploadedFiles.length < 2) {
      cleanupFiles(uploadedFiles.map(f => f.path));
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Collect file paths
    const inputPaths = uploadedFiles.map(file => file.path);
    tempFiles.push(...inputPaths);

    // Generate output filename
    const outputFilename = `/tmp/concatenated_${uuidv4()}.pdf`;
    tempFiles.push(outputFilename);

    // Build pdfunite command arguments
    const args = [...inputPaths, outputFilename];

    // Execute pdfunite with timeout
    execFile('pdfunite', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('pdfunite error:', error);
        console.error('stderr:', stderr);
        cleanupFiles(tempFiles);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check if output file was created
      if (!fs.existsSync(outputFilename)) {
        cleanupFiles(tempFiles);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Read the concatenated PDF
      fs.readFile(outputFilename, (err, data) => {
        if (err) {
          console.error('Error reading output file:', err);
          cleanupFiles(tempFiles);
          return res.status(500).json({ error: 'An error occurred while processing the files.' });
        }

        // Send the PDF file
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="concatenated.pdf"'
        });
        res.send(data);

        // Clean up temporary files
        cleanupFiles(tempFiles);
      });
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    cleanupFiles(tempFiles);
    
    if (err.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    return res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer
app.use((err, req, res, next) => {
  // Clean up any uploaded files if they exist
  if (req.files && req.files.length > 0) {
    cleanupFiles(req.files.map(f => f.path));
  }
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (err) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});