const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Configure multer for file uploads with memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to clean up temp files
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error cleaning up file:', error);
  }
};

// Convert PDF to text endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let tempFilePath = null;
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate a unique filename to prevent conflicts
    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.pdf`;
    tempFilePath = path.join(tempDir, uniqueFilename);

    // Write the uploaded file to disk
    fs.writeFileSync(tempFilePath, req.file.buffer);

    // Execute pdftotext command
    exec(`pdftotext -layout -nopgbrk "${tempFilePath}" -`, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for output
      timeout: 30000 // 30 second timeout
    }, (error, stdout, stderr) => {
      // Clean up the temp file
      cleanupFile(tempFilePath);

      if (error) {
        console.error('PDF conversion error:', error);
        return res.status(500).json({ error: 'Failed to convert PDF to text' });
      }

      // Send the extracted text as plain text
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(stdout);
    });

  } catch (error) {
    // Clean up temp file if it exists
    if (tempFilePath) {
      cleanupFile(tempFilePath);
    }

    console.error('Error processing request:', error);
    
    if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Clean up temp directory on exit
process.on('SIGINT', () => {
  try {
    const files = fs.readdirSync(tempDir);
    files.forEach(file => {
      cleanupFile(path.join(tempDir, file));
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  process.exit(0);
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF to Text API server running on http://${HOST}:${PORT}`);
});