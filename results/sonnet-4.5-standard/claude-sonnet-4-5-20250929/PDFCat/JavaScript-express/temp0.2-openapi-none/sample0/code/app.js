<CODE>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

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

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), (req, res) => {
  // Check if files were uploaded
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  // Check if at least 2 files were uploaded
  if (req.files.length < 2) {
    // Clean up uploaded files
    req.files.forEach(file => {
      fs.unlink(file.path, () => {});
    });
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  // Generate output filename
  const outputFilename = `/tmp/${uuidv4()}.pdf`;
  
  // Build pdfunite command
  const inputFiles = req.files.map(file => file.path).join(' ');
  const command = `pdfunite ${inputFiles} ${outputFilename}`;

  // Execute pdfunite command
  exec(command, (error, stdout, stderr) => {
    // Clean up input files
    req.files.forEach(file => {
      fs.unlink(file.path, () => {});
    });

    if (error) {
      // Clean up output file if it exists
      if (fs.existsSync(outputFilename)) {
        fs.unlink(outputFilename, () => {});
      }
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Check if output file was created
    if (!fs.existsSync(outputFilename)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Send the concatenated PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    
    const fileStream = fs.createReadStream(outputFilename);
    
    fileStream.on('error', () => {
      fs.unlink(outputFilename, () => {});
      if (!res.headersSent) {
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });

    fileStream.on('end', () => {
      // Clean up output file after sending
      fs.unlink(outputFilename, () => {});
    });

    fileStream.pipe(res);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on port ${PORT}`);
});
</CODE>