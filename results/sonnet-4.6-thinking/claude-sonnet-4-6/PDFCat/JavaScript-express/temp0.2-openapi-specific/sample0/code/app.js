const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Configure multer to store files in a temp directory with safe filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-concat-'));
    req._tmpDir = req._tmpDir || tmpDir;
    cb(null, req._tmpDir);
  },
  filename: (req, file, cb) => {
    // Use a UUID-based filename to avoid any path traversal or injection
    const safeFilename = uuidv4() + '.pdf';
    cb(null, safeFilename);
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
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 20 // max 20 files
  }
});

// Helper to clean up temp directory
function cleanupDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        fs.unlinkSync(path.join(dirPath, file));
      }
      fs.rmdirSync(dirPath);
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

app.post('/concatenate', (req, res) => {
  // We need to handle multer manually to get access to tmpDir per request
  // Since multer.diskStorage destination callback shares state via req._tmpDir,
  // we need a different approach: create tmpDir before multer runs

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-concat-'));

  const storagePerReq = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      const safeFilename = uuidv4() + '.pdf';
      cb(null, safeFilename);
    }
  });

  const uploadPerReq = multer({
    storage: storagePerReq,
    fileFilter: fileFilter,
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 20
    }
  }).array('files');

  uploadPerReq(req, res, (err) => {
    if (err) {
      cleanupDir(tmpDir);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'One or more files exceed the size limit.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files uploaded.' });
      }
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    if (!req.files || req.files.length === 0) {
      cleanupDir(tmpDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    if (req.files.length < 2) {
      cleanupDir(tmpDir);
      return res.status(400).json({ error: 'At least two PDF files are required for concatenation.' });
    }

    // Build the list of input file paths (all are UUID-named, safe paths within tmpDir)
    const inputFiles = req.files.map(f => {
      // Validate that the file path is within tmpDir (prevent path traversal)
      const resolvedPath = path.resolve(f.path);
      const resolvedTmpDir = path.resolve(tmpDir);
      if (!resolvedPath.startsWith(resolvedTmpDir + path.sep)) {
        return null;
      }
      return resolvedPath;
    });

    if (inputFiles.some(f => f === null)) {
      cleanupDir(tmpDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    const outputFilename = uuidv4() + '.pdf';
    const outputPath = path.join(tmpDir, outputFilename);

    // Use execFile to avoid shell injection - arguments are passed as array, not shell string
    const args = [...inputFiles, outputPath];

    execFile('pdfunite', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        cleanupDir(tmpDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check output file exists
      if (!fs.existsSync(outputPath)) {
        cleanupDir(tmpDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const readStream = fs.createReadStream(outputPath);
      readStream.on('end', () => {
        cleanupDir(tmpDir);
      });
      readStream.on('error', () => {
        cleanupDir(tmpDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });
      readStream.pipe(res);
    });
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on ${HOST}:${PORT}`);
});