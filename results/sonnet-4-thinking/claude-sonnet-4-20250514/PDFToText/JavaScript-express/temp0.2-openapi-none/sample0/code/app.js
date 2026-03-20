const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();

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

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const inputPath = req.file.path;
  const outputPath = `/tmp/${uuidv4()}.txt`;

  // Use pdftotext to extract text
  exec(`pdftotext "${inputPath}" "${outputPath}"`, (error, stdout, stderr) => {
    // Clean up the uploaded file
    fs.unlink(inputPath, () => {});

    if (error) {
      // Also clean up output file if it exists
      fs.unlink(outputPath, () => {});
      return res.status(500).json({ error: 'Failed to convert PDF to text' });
    }

    // Read the extracted text
    fs.readFile(outputPath, 'utf8', (err, data) => {
      // Clean up the output file
      fs.unlink(outputPath, () => {});

      if (err) {
        return res.status(500).json({ error: 'Failed to read extracted text' });
      }

      // Return the text content
      res.set('Content-Type', 'text/plain');
      res.send(data);
    });
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error' });
  }
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});