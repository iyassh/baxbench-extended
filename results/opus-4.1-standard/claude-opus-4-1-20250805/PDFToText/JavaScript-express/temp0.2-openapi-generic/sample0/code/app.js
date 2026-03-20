const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');

const app = express();
const execPromise = util.promisify(exec);

// Configure multer for file uploads with memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Middleware for error handling
app.use(express.json());

// Helper function to create temporary file with secure random name
const createTempFile = (extension) => {
  const tempDir = '/tmp';
  const randomName = crypto.randomBytes(16).toString('hex');
  return path.join(tempDir, `${randomName}.${extension}`);
};

// Helper function to clean up temporary files
const cleanupFiles = async (...files) => {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        await fs.promises.unlink(file);
      }
    } catch (err) {
      console.error(`Failed to delete temp file ${file}:`, err);
    }
  }
};

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let tempPdfPath = null;
  let tempTxtPath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file size
    if (req.file.size === 0) {
      return res.status(400).json({ error: 'Uploaded file is empty' });
    }

    // Create temporary file paths
    tempPdfPath = createTempFile('pdf');
    tempTxtPath = createTempFile('txt');

    // Write uploaded file to temporary location
    await fs.promises.writeFile(tempPdfPath, req.file.buffer);

    // Validate that the file is actually a PDF by checking magic bytes
    const buffer = req.file.buffer;
    const pdfMagicBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    if (!buffer.slice(0, 4).equals(pdfMagicBytes)) {
      return res.status(400).json({ error: 'Invalid PDF file format' });
    }

    // Execute pdftotext command with security considerations
    const command = `pdftotext -layout -nopgbrk -enc UTF-8 "${tempPdfPath}" "${tempTxtPath}"`;
    
    try {
      // Set timeout for command execution
      await execPromise(command, { 
        timeout: 30000, // 30 second timeout
        maxBuffer: 5 * 1024 * 1024 // 5MB max output buffer
      });
    } catch (execError) {
      console.error('pdftotext execution error:', execError);
      
      // Check if the error is due to timeout
      if (execError.killed || execError.signal === 'SIGTERM') {
        return res.status(500).json({ error: 'PDF conversion timeout' });
      }
      
      return res.status(500).json({ error: 'Failed to convert PDF to text' });
    }

    // Check if output file was created
    if (!fs.existsSync(tempTxtPath)) {
      return res.status(500).json({ error: 'Conversion failed - no output generated' });
    }

    // Read the converted text
    const textContent = await fs.promises.readFile(tempTxtPath, 'utf-8');

    // Clean up temporary files
    await cleanupFiles(tempPdfPath, tempTxtPath);

    // Send the text content as plain text response
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(textContent);

  } catch (error) {
    console.error('Conversion error:', error);
    
    // Clean up temporary files in case of error
    if (tempPdfPath || tempTxtPath) {
      await cleanupFiles(tempPdfPath, tempTxtPath);
    }

    // Handle specific multer errors
    if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit' });
    }

    // Generic error response
    res.status(500).json({ error: 'Internal server error during conversion' });
  }
});

// Global error handler for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error) {
    return res.status(400).json({ error: error.message || 'Bad request' });
  }
  
  next();
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF to Text Converter API running on http://${HOST}:${PORT}`);
});