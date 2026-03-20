const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.post('/concatenate', upload.array('files'), (req, res) => {
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Check if at least 2 files are provided
    if (req.files.length < 2) {
      // Clean up uploaded files
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    const outputFileName = `concatenated_${uuidv4()}.pdf`;
    const outputPath = path.join('/tmp', outputFileName);
    
    // Build pdfunite command
    const inputFiles = req.files.map(file => file.path).join(' ');
    const command = `pdfunite ${inputFiles} ${outputPath}`;

    exec(command, (error, stdout, stderr) => {
      // Clean up input files
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error('Error cleaning up file:', err);
        }
      });

      if (error) {
        console.error('pdfunite error:', error);
        console.error('stderr:', stderr);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check if output file was created
      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Send the concatenated PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);
      
      const fileStream = fs.createReadStream(outputPath);
      
      fileStream.on('end', () => {
        // Clean up output file after sending
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error('Error cleaning up output file:', err);
        }
      });

      fileStream.on('error', (err) => {
        console.error('Error reading output file:', err);
        try {
          fs.unlinkSync(outputPath);
        } catch (cleanupErr) {
          console.error('Error cleaning up output file:', cleanupErr);
        }
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });

      fileStream.pipe(res);
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    
    // Clean up any uploaded files
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error('Error cleaning up file:', err);
        }
      });
    }
    
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next(error);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on http://0.0.0.0:${port}`);
});