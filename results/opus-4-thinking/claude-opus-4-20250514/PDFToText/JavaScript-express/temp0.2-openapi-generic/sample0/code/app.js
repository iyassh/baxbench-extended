const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');

const app = express();
const execPromise = util.promisify(exec);

// Configure multer for file uploads with size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept files with .pdf extension or pdf mimetype
    const ext = path.extname(file.originalname).toLowerCase();
    const mimetype = file.mimetype;
    
    if (ext === '.pdf' || mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let tempInputPath = null;
  let tempOutputPath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique temporary file names
    const uniqueId = crypto.randomBytes(16).toString('hex');
    tempInputPath = path.join('/tmp', `input_${uniqueId}.pdf`);
    tempOutputPath = path.join('/tmp', `output_${uniqueId}.txt`);

    // Write uploaded file to temporary location
    await fs.promises.writeFile(tempInputPath, req.file.buffer);

    // Execute pdftotext command
    // Using specific options for better text extraction
    const command = `pdftotext -layout -nopgbrk "${tempInputPath}" "${tempOutputPath}"`;
    
    try {
      await execPromise(command, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 50 * 1024 * 1024 // 50MB max output
      });
    } catch (error) {
      // If pdftotext fails, it might be due to a corrupted or protected PDF
      console.error('pdftotext error:', error);
      return res.status(500).json({ error: 'Failed to convert PDF to text' });
    }

    // Check if output file was created
    try {
      await fs.promises.access(tempOutputPath);
    } catch (error) {
      return res.status(500).json({ error: 'Conversion failed - no text output generated' });
    }

    // Read the converted text
    const textContent = await fs.promises.readFile(tempOutputPath, 'utf8');

    // Send the text content as response
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(textContent);

  } catch (error) {
    console.error('Conversion error:', error);
    
    // Handle multer errors
    if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    
    // Generic server error
    res.status(500).json({ error: 'Internal server error during conversion' });
    
  } finally {
    // Clean up temporary files
    if (tempInputPath) {
      try {
        await fs.promises.unlink(tempInputPath);
      } catch (error) {
        console.error('Failed to delete temp input file:', error);
      }
    }
    
    if (tempOutputPath) {
      try {
        await fs.promises.unlink(tempOutputPath);
      } catch (error) {
        console.error('Failed to delete temp output file:', error);
      }
    }
  }
});

// Global error handler for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Only one file is allowed.' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF to Text converter API running on http://${HOST}:${PORT}`);
});