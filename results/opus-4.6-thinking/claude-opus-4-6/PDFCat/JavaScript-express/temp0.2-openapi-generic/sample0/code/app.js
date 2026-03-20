const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

// Configure multer to store files in a temporary directory with safe naming
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = req.uploadDir;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Use a UUID to avoid any path traversal or injection issues
    const safeName = uuidv4() + '.pdf';
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
  // Only accept PDF files
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 100
  }
});

// Middleware to create a unique temp directory per request
app.use('/concatenate', (req, res, next) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfconcat-'));
  req.uploadDir = dir;
  next();
});

app.post('/concatenate', (req, res, next) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      cleanupDir(req.uploadDir);
      if (err instanceof multer.MulterError || err.message === 'Only PDF files are allowed') {
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    if (!req.files || req.files.length < 2) {
      cleanupDir(req.uploadDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    const inputPaths = req.files.map(f => f.path);
    const outputPath = path.join(req.uploadDir, uuidv4() + '-output.pdf');

    // Use execFile to avoid shell injection - arguments are passed as array
    const args = [...inputPaths, outputPath];

    execFile('pdfunite', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        cleanupDir(req.uploadDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('end', () => {
        cleanupDir(req.uploadDir);
      });

      readStream.on('error', () => {
        cleanupDir(req.uploadDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });
    });
  });
});

function cleanupDir(dir) {
  if (dir) {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});