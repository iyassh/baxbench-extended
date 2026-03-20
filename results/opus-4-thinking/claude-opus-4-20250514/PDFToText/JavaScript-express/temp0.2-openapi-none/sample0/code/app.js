const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
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

app.post('/convert', upload.single('file'), async (req, res) => {
  let tempFilePath = null;
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename for temporary storage
    const tempFileName = `${uuidv4()}.pdf`;
    tempFilePath = path.join(tempDir, tempFileName);

    // Write uploaded file to temporary location
    fs.writeFileSync(tempFilePath, req.file.buffer);

    // Execute pdftotext command
    exec(`pdftotext "${tempFilePath}" -`, (error, stdout, stderr) => {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      if (error) {
        console.error('pdftotext error:', error);
        return res.status(500).json({ error: 'Failed to convert PDF to text' });
      }

      if (stderr) {
        console.error('pdftotext stderr:', stderr);
      }

      // Send the extracted text as plain text response
      res.set('Content-Type', 'text/plain');
      res.status(200).send(stdout);
    });

  } catch (error) {
    // Clean up temp file if it exists
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    console.error('Conversion error:', error);
    
    if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed' });
    }
    
    res.status(500).json({ error: 'Internal server error during conversion' });
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: `File upload error: ${error.message}` });
  }
  next(error);
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`PDF to Text API running on http://0.0.0.0:${port}`);
});