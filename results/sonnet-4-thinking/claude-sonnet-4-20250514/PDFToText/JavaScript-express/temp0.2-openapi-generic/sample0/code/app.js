const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer for file uploads with security constraints
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Check if file is a PDF
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.post('/convert', upload.single('file'), async (req, res) => {
  let tempFilePath = null;
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create a temporary file with unique name
    const tempDir = os.tmpdir();
    const fileName = `pdf_${uuidv4()}.pdf`;
    tempFilePath = path.join(tempDir, fileName);

    // Write uploaded file to temporary location
    fs.writeFileSync(tempFilePath, req.file.buffer);

    // Run pdftotext to extract text
    const text = await extractTextFromPDF(tempFilePath);
    
    // Return the extracted text as plain text
    res.setHeader('Content-Type', 'text/plain');
    res.send(text);

  } catch (error) {
    console.error('Error processing PDF:', error);
    
    if (error.message.includes('Only PDF files')) {
      return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
    }
    
    res.status(500).json({ error: 'Failed to convert PDF to text' });
  } finally {
    // Clean up temporary file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
  }
});

// Function to extract text from PDF using pdftotext
function extractTextFromPDF(filePath) {
  return new Promise((resolve, reject) => {
    const pdftotext = spawn('pdftotext', [filePath, '-']);
    
    let output = '';
    let error = '';

    pdftotext.stdout.on('data', (data) => {
      output += data.toString();
    });

    pdftotext.stderr.on('data', (data) => {
      error += data.toString();
    });

    pdftotext.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`pdftotext failed with code ${code}: ${error}`));
      }
    });

    pdftotext.on('error', (err) => {
      reject(new Error(`Failed to spawn pdftotext: ${err.message}`));
    });
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error.message.includes('Only PDF files')) {
    return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF to Text Converter API running on http://0.0.0.0:${PORT}`);
});