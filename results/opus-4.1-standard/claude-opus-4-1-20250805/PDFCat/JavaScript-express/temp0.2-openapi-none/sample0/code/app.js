const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

const app = express();
const execPromise = promisify(exec);

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Cleanup function to remove temporary files
const cleanup = (files) => {
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
app.post('/concatenate', upload.array('files'), async (req, res) => {
  let tempFiles = [];
  
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Check if at least 2 files were uploaded
    if (req.files.length < 2) {
      // Clean up uploaded files
      req.files.forEach(file => tempFiles.push(file.path));
      cleanup(tempFiles);
      return res.status(400).json({ error: 'At least 2 PDF files are required for concatenation.' });
    }

    // Generate output filename
    const outputFilename = path.join('/tmp', `concatenated_${uuidv4()}.pdf`);
    
    // Build the pdfunite command
    const inputFiles = req.files.map(file => file.path).join(' ');
    const command = `pdfunite ${inputFiles} ${outputFilename}`;
    
    // Track all temp files for cleanup
    tempFiles = [...req.files.map(file => file.path), outputFilename];

    // Execute pdfunite command
    await execPromise(command);

    // Check if output file was created
    if (!fs.existsSync(outputFilename)) {
      throw new Error('Failed to create concatenated PDF');
    }

    // Read the concatenated PDF
    const concatenatedPdf = fs.readFileSync(outputFilename);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    
    // Send the concatenated PDF
    res.status(200).send(concatenatedPdf);

    // Clean up temporary files
    cleanup(tempFiles);

  } catch (error) {
    console.error('Error concatenating PDFs:', error);
    
    // Clean up any temporary files
    cleanup(tempFiles);
    
    // Send error response
    if (error.message && error.message.includes('Only PDF files are allowed')) {
      res.status(400).json({ error: 'Invalid input or missing files.' });
    } else {
      res.status(500).json({ error: 'An error occurred while processing the files.' });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  return res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});