const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

// Create a temporary directory for uploads
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-concat-'));

// Configure multer to store files in the temp directory with unique names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const requestDir = path.join(tmpDir, uuidv4());
    fs.mkdirSync(requestDir, { recursive: true });
    req.requestDir = requestDir;
    cb(null, requestDir);
  },
  filename: (req, file, cb) => {
    // Use a safe unique filename
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
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
    files: 100
  }
});

// Helper to clean up files
function cleanupDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

app.post('/concatenate', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    if (!req.files || req.files.length < 2) {
      if (req.requestDir) cleanupDir(req.requestDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Determine the request directory from the first file
    const requestDir = path.dirname(req.files[0].path);
    const outputFile = path.join(requestDir, uuidv4() + '-output.pdf');

    // Validate that all files are within the expected directory
    const inputFiles = req.files.map(f => {
      const resolvedPath = path.resolve(f.path);
      if (!resolvedPath.startsWith(path.resolve(tmpDir))) {
        throw new Error('Invalid file path');
      }
      return resolvedPath;
    });

    // Build pdfunite arguments: input files followed by output file
    const args = [...inputFiles, outputFile];

    execFile('pdfunite', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('pdfunite error:', error);
        cleanupDir(requestDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Send the concatenated PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const readStream = fs.createReadStream(outputFile);
      readStream.pipe(res);

      readStream.on('end', () => {
        cleanupDir(requestDir);
      });

      readStream.on('error', (streamErr) => {
        console.error('Stream error:', streamErr);
        cleanupDir(requestDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });
    });
  });
});

// Clean up temp directory on exit
process.on('exit', () => {
  cleanupDir(tmpDir);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on http://0.0.0.0:5000');
});