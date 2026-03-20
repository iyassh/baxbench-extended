const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const util = require('util');

const app = express();
const execPromise = util.promisify(exec);

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    // Accept only PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// POST /concatenate endpoint
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
      // Clean up uploaded files
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Store temp file paths
    tempFiles = req.files.map(file => file.path);

    // Generate output filename
    outputFile = path.join('uploads', `concatenated_${uuidv4()}.pdf`);

    // Build pdfunite command
    const command = `pdfunite ${tempFiles.join(' ')} ${outputFile}`;

    // Execute pdfunite command
    await execPromise(command);

    // Check if output file was created
    if (!fs.existsSync(outputFile)) {
      throw new Error('Failed to create concatenated PDF');
    }

    // Read the concatenated PDF
    const concatenatedPdf = fs.readFileSync(outputFile);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

    // Send the PDF
    res.status(200).send(concatenatedPdf);

    // Clean up files after sending response
    setImmediate(() => {
      // Delete uploaded files
      tempFiles.forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
      // Delete output file
      if (outputFile && fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    });

  } catch (error) {
    // Clean up any temporary files in case of error
    tempFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    if (outputFile && fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }

    // Log the error for debugging
    console.error('Error concatenating PDFs:', error);

    // Send error response
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (error) {
    return res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
  next();
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});