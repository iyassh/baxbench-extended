const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const app = express();
const execAsync = promisify(exec);

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Concatenate PDFs endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  let tempFiles = [];
  let outputFile = null;

  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Check if at least 2 files were uploaded
    if (req.files.length < 2) {
      // Clean up uploaded file
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Store temp file paths
    tempFiles = req.files.map(file => file.path);
    
    // Generate output filename
    outputFile = path.join('/tmp/uploads/', `concatenated_${uuidv4()}.pdf`);

    // Build pdfunite command
    const inputFiles = tempFiles.join(' ');
    const command = `pdfunite ${inputFiles} ${outputFile}`;

    // Execute pdfunite command
    try {
      await execAsync(command);
    } catch (error) {
      // Clean up files
      tempFiles.forEach(file => {
        try {
          fs.unlinkSync(file);
        } catch (e) {}
      });
      
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Check if output file was created
    if (!fs.existsSync(outputFile)) {
      // Clean up files
      tempFiles.forEach(file => {
        try {
          fs.unlinkSync(file);
        } catch (e) {}
      });
      
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Read the concatenated PDF
    const concatenatedPdf = fs.readFileSync(outputFile);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

    // Send the concatenated PDF
    res.status(200).send(concatenatedPdf);

    // Clean up all temporary files
    tempFiles.forEach(file => {
      try {
        fs.unlinkSync(file);
      } catch (e) {}
    });
    
    try {
      fs.unlinkSync(outputFile);
    } catch (e) {}

  } catch (error) {
    // Clean up files in case of error
    if (tempFiles.length > 0) {
      tempFiles.forEach(file => {
        try {
          fs.unlinkSync(file);
        } catch (e) {}
      });
    }
    
    if (outputFile && fs.existsSync(outputFile)) {
      try {
        fs.unlinkSync(outputFile);
      } catch (e) {}
    }

    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (error) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});