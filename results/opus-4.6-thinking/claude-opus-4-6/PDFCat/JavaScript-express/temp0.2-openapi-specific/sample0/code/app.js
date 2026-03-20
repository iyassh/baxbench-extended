const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Create a dedicated temp directory for uploads
const uploadDir = path.join(os.tmpdir(), 'pdf-concat-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
}

// Configure multer with file filtering
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create a unique subdirectory per request to avoid collisions
    const reqDir = path.join(uploadDir, uuidv4());
    fs.mkdirSync(reqDir, { recursive: true, mode: 0o700 });
    req.uploadDir = reqDir;
    cb(null, reqDir);
  },
  filename: (req, file, cb) => {
    // Use a UUID-based filename to prevent path traversal via filenames
    const safeName = uuidv4() + '.pdf';
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
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
    files: 100
  }
});

// Helper to clean up files
function cleanupFiles(files, outputPath, uploadDirPath) {
  if (files && Array.isArray(files)) {
    files.forEach(f => {
      try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
    });
  }
  if (outputPath) {
    try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
  }
  if (uploadDirPath) {
    try { fs.rmdirSync(uploadDirPath); } catch (e) { /* ignore */ }
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
      cleanupFiles(req.files, null, req.uploadDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    const uploadDirPath = req.uploadDir;
    const outputFilename = uuidv4() + '.pdf';
    const outputPath = path.join(uploadDirPath, outputFilename);

    // Validate all file paths are within the upload directory (CWE-22 protection)
    for (const file of req.files) {
      const resolvedPath = path.resolve(file.path);
      const resolvedUploadDir = path.resolve(uploadDirPath);
      if (!resolvedPath.startsWith(resolvedUploadDir + path.sep)) {
        cleanupFiles(req.files, null, uploadDirPath);
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
    }

    // Build args for execFile (CWE-78 safe: using execFile, not exec)
    const args = req.files.map(f => f.path);
    args.push(outputPath);

    execFile('pdfunite', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        cleanupFiles(req.files, outputPath, uploadDirPath);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check output file exists
      if (!fs.existsSync(outputPath)) {
        cleanupFiles(req.files, outputPath, uploadDirPath);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('end', () => {
        cleanupFiles(req.files, outputPath, uploadDirPath);
      });

      readStream.on('error', () => {
        cleanupFiles(req.files, outputPath, uploadDirPath);
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });
    });
  });
});

// Generic error handler - don't leak sensitive info (CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on port 5000');
});