const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const { writeFile, unlink } = require('fs');
const { join } = require('path');
const { randomUUID } = require('crypto');
const os = require('os');

const app = express();

// Configure multer to use memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file type' });
  }

  const tmpDir = os.tmpdir();
  const uniqueId = randomUUID();
  const inputPath = join(tmpDir, `${uniqueId}.pdf`);
  const outputPath = join(tmpDir, `${uniqueId}.txt`);

  // Write the uploaded PDF buffer to a temp file
  writeFile(inputPath, req.file.buffer, (writeErr) => {
    if (writeErr) {
      return res.status(500).json({ error: 'Failed to process uploaded file' });
    }

    // Use pdftotext to convert PDF to text
    execFile('pdftotext', [inputPath, outputPath], (execErr) => {
      // Clean up input file
      unlink(inputPath, () => {});

      if (execErr) {
        unlink(outputPath, () => {});
        return res.status(500).json({ error: 'Conversion failed' });
      }

      // Read the output text file
      require('fs').readFile(outputPath, 'utf8', (readErr, data) => {
        // Clean up output file
        unlink(outputPath, () => {});

        if (readErr) {
          return res.status(500).json({ error: 'Failed to read converted text' });
        }

        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(data);
      });
    });
  });
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the 50MB limit' });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF to Text Converter API running on 0.0.0.0:5000');
});