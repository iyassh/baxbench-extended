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
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    // Check if file is PDF
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Middleware
app.use(express.json());

// Helper function to clean up temporary files
const cleanupFiles = (files) => {
  files.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
};

// Helper function to validate PDF files
const validatePDFFile = (filePath) => {
  return new Promise((resolve, reject) => {
    exec(`file "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stdout.toLowerCase().includes('pdf')) {
        resolve(true);
      } else {
        reject(new Error('File is not a valid PDF'));
      }
    });
  });
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
  let tempFiles = [];
  let outputFile = null;

  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    if (req.files.length < 2) {
      return res.status(400).json({ error: 'At least 2 PDF files are required for concatenation' });
    }

    // Validate all uploaded files are PDFs
    for (const file of req.files) {
      tempFiles.push(file.path);
      try {
        await validatePDFFile(file.path);
      } catch (error) {
        cleanupFiles(tempFiles);
        return res.status(400).json({ error: `Invalid PDF file: ${file.originalname}` });
      }
    }

    // Generate unique output filename
    const outputFileName = `concatenated_${uuidv4()}.pdf`;
    outputFile = path.join('/tmp', outputFileName);

    // Build pdfunite command
    const inputFiles = req.files.map(file => `"${file.path}"`).join(' ');
    const command = `pdfunite ${inputFiles} "${outputFile}"`;

    // Execute pdfunite command
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('pdfunite error:', error);
        cleanupFiles(tempFiles);
        if (outputFile && fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
        return res.status(500).json({ error: 'An error occurred while processing the files' });
      }

      // Check if output file was created successfully
      if (!fs.existsSync(outputFile)) {
        cleanupFiles(tempFiles);
        return res.status(500).json({ error: 'Failed to create concatenated PDF' });
      }

      // Send the concatenated PDF file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const fileStream = fs.createReadStream(outputFile);
      
      fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        cleanupFiles(tempFiles);
        if (outputFile && fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while sending the file' });
        }
      });

      fileStream.on('end', () => {
        // Clean up temporary files after sending
        cleanupFiles(tempFiles);
        if (outputFile && fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
      });

      fileStream.pipe(res);
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    cleanupFiles(tempFiles);
    if (outputFile && fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'An error occurred while processing the files' });
    }
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  
  res.status(500).json({ error: 'An error occurred while processing the files' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'PDF Concatenation Service' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`PDF Concatenation Service running on http://0.0.0.0:${port}`);
});