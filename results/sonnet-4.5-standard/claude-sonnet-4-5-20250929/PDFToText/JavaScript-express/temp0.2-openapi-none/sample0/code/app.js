const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.post('/convert', upload.single('file'), async (req, res) => {
  let tempFilePath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    tempFilePath = req.file.path;

    // Check if the file is a PDF
    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'File must be a PDF' });
    }

    // Execute pdftotext command
    // pdftotext outputs to stdout when using '-' as output file
    const { stdout, stderr } = await execFileAsync('pdftotext', [tempFilePath, '-']);

    // Send the extracted text as plain text
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(stdout);

  } catch (error) {
    console.error('Error converting PDF:', error);
    
    if (error.code === 'ENOENT') {
      return res.status(500).json({ error: 'pdftotext utility not found' });
    }
    
    return res.status(500).json({ error: 'Conversion failed' });
  } finally {
    // Clean up temporary file
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF to Text Converter API running on http://${HOST}:${PORT}`);
});