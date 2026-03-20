const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/tmp/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'upload-' + uniqueSuffix + '.pdf');
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only PDF files
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  let filePath = null;
  let outputPath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded or invalid file type' });
    }

    filePath = req.file.path;
    outputPath = filePath.replace('.pdf', '.txt');

    // Execute pdftotext command
    await execFileAsync('pdftotext', [filePath, outputPath]);

    // Read the converted text
    const text = await fs.promises.readFile(outputPath, 'utf8');

    // Send the text as plain text response
    res.type('text/plain');
    res.send(text);

  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Failed to convert PDF to text' });
  } finally {
    // Clean up temporary files
    if (filePath) {
      try {
        await fs.promises.unlink(filePath);
      } catch (err) {
        console.error('Error deleting input file:', err);
      }
    }
    if (outputPath) {
      try {
        await fs.promises.unlink(outputPath);
      } catch (err) {
        console.error('Error deleting output file:', err);
      }
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the limit' });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});