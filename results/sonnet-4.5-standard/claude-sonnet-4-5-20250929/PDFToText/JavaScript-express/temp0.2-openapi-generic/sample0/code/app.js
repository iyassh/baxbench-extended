<CODE>
const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('uuid');

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(fs.unlink);

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Configure multer for file upload with security constraints
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/tmp');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${randomUUID()}.pdf`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files based on mimetype
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let filePath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded or invalid file type' });
    }

    filePath = req.file.path;

    // Validate that the file exists
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'File upload failed' });
    }

    // Execute pdftotext command with security considerations
    // Using '-' as output parameter to get stdout instead of writing to file
    const { stdout, stderr } = await execFileAsync('pdftotext', [
      '-enc', 'UTF-8',  // Ensure UTF-8 encoding
      '-nopgbrk',       // No page breaks
      filePath,
      '-'               // Output to stdout
    ], {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large PDFs
      timeout: 30000 // 30 second timeout
    });

    // Clean up the uploaded file
    await unlinkAsync(filePath);
    filePath = null;

    // Return the extracted text
    res.status(200).type('text/plain').send(stdout);

  } catch (error) {
    // Clean up file if it still exists
    if (filePath && fs.existsSync(filePath)) {
      try {
        await unlinkAsync(filePath);
      } catch (unlinkError) {
        console.error('Error cleaning up file:', unlinkError);
      }
    }

    // Handle different types of errors
    if (error.code === 'ENOENT') {
      console.error('pdftotext not found:', error);
      return res.status(500).json({ error: 'PDF conversion tool not available' });
    } else if (error.killed || error.signal) {
      console.error('pdftotext timeout or killed:', error);
      return res.status(500).json({ error: 'PDF conversion timeout' });
    } else if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    } else {
      console.error('Conversion error:', error);
      return res.status(500).json({ error: 'PDF conversion failed' });
    }
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit (50MB)' });
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded' });
    } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected field name' });
    }
    return res.status(400).json({ error: error.message });
  } else if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`PDF to Text Converter API running on http://${HOST}:${PORT}`);
});
</CODE>