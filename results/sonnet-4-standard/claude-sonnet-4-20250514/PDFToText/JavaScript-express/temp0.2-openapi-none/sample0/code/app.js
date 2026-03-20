const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = '/tmp/uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + '.pdf';
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Convert PDF to text using pdftotext
function convertPdfToText(filePath) {
  return new Promise((resolve, reject) => {
    const pdftotext = spawn('pdftotext', [filePath, '-']);
    
    let textOutput = '';
    let errorOutput = '';
    
    pdftotext.stdout.on('data', (data) => {
      textOutput += data.toString();
    });
    
    pdftotext.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    pdftotext.on('close', (code) => {
      if (code === 0) {
        resolve(textOutput);
      } else {
        reject(new Error(`pdftotext failed with code ${code}: ${errorOutput}`));
      }
    });
    
    pdftotext.on('error', (error) => {
      reject(new Error(`Failed to start pdftotext: ${error.message}`));
    });
  });
}

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    
    try {
      const textContent = await convertPdfToText(filePath);
      
      // Clean up the uploaded file
      fs.unlinkSync(filePath);
      
      res.set('Content-Type', 'text/plain');
      res.status(200).send(textContent);
      
    } catch (conversionError) {
      // Clean up the uploaded file even if conversion fails
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      console.error('PDF conversion error:', conversionError.message);
      res.status(500).json({ error: 'Failed to convert PDF to text' });
    }
    
  } catch (error) {
    console.error('Upload error:', error.message);
    
    if (error.message === 'Only PDF files are allowed') {
      res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
    } else if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`PDF to Text Converter API running on http://0.0.0.0:${port}`);
});