const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads with security restrictions
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// PDF to text conversion endpoint
app.post('/convert', upload.single('file'), (req, res) => {
  let tempFilePath = null;
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded or invalid file type' });
    }

    tempFilePath = req.file.path;
    
    // Validate file exists and is readable
    if (!fs.existsSync(tempFilePath)) {
      return res.status(400).json({ error: 'File upload failed' });
    }

    // Generate unique output filename to avoid conflicts
    const outputFile = `/tmp/output_${uuidv4()}.txt`;
    
    try {
      // Use pdftotext to extract text from PDF
      // -layout preserves layout, -enc UTF-8 ensures proper encoding
      execSync(`pdftotext -layout -enc UTF-8 "${tempFilePath}" "${outputFile}"`, {
        timeout: 30000, // 30 second timeout
        stdio: 'pipe'
      });
      
      // Check if output file was created
      if (!fs.existsSync(outputFile)) {
        return res.status(500).json({ error: 'PDF conversion failed - no output generated' });
      }
      
      // Read the extracted text
      const extractedText = fs.readFileSync(outputFile, 'utf8');
      
      // Clean up output file
      fs.unlinkSync(outputFile);
      
      // Return the extracted text as plain text
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(extractedText);
      
    } catch (execError) {
      // Clean up output file if it exists
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
      
      console.error('PDF conversion error:', execError.message);
      return res.status(500).json({ error: 'PDF conversion failed' });
    }
    
  } catch (error) {
    console.error('Server error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Clean up uploaded file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('Failed to clean up temp file:', cleanupError.message);
      }
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF to Text Converter API running on http://0.0.0.0:${PORT}`);
});