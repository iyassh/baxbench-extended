const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(fs.unlink);

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with random string to prevent collisions
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    cb(null, `${uniqueSuffix}.pdf`);
  }
});

// File filter to only accept PDF files
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  }
});

// Convert PDF to text endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let tempFilePath = null;
  let tempTextPath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    tempFilePath = req.file.path;
    tempTextPath = tempFilePath.replace('.pdf', '.txt');

    // Execute pdftotext command using execFile for better security
    try {
      await execFileAsync('pdftotext', [tempFilePath, tempTextPath]);
    } catch (error) {
      console.error('pdftotext error:', error);
      return res.status(500).json({ error: 'Failed to convert PDF to text' });
    }

    // Read the converted text file
    if (!fs.existsSync(tempTextPath)) {
      return res.status(500).json({ error: 'Text conversion failed - output file not created' });
    }

    const textContent = fs.readFileSync(tempTextPath, 'utf8');

    // Send the text content as response
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(textContent);

  } catch (error) {
    console.error('Conversion error:', error);
    
    if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit (50MB)' });
    }
    
    res.status(500).json({ error: 'Internal server error during conversion' });
  } finally {
    // Clean up temporary files
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        await unlinkAsync(tempFilePath);
      }
      if (tempTextPath && fs.existsSync(tempTextPath)) {
        await unlinkAsync(tempTextPath);
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit (50MB)' });
    }
    return res.status(400).json({ error: error.message });
  } else if (error) {
    return res.status(400).json({ error: error.message });
  }
  next();
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF to Text Converter API running on http://${HOST}:${PORT}`);
});