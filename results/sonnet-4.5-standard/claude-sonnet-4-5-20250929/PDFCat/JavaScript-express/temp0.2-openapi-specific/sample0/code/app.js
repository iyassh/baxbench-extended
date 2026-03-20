const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Create a temporary directory for file operations
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = uuidv4();
    const sessionDir = path.join(TEMP_DIR, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    req.sessionDir = sessionDir;
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent path traversal
    const sanitizedName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuidv4()}_${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 20 // Maximum 20 files
  },
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Cleanup function to remove temporary files
function cleanupFiles(directory) {
  try {
    if (directory && fs.existsSync(directory)) {
      const files = fs.readdirSync(directory);
      files.forEach(file => {
        const filePath = path.join(directory, file);
        fs.unlinkSync(filePath);
      });
      fs.rmdirSync(directory);
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

// Validate that path is within allowed directory
function isPathSafe(filePath, baseDir) {
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedPath.startsWith(resolvedBase);
}

app.post('/concatenate', upload.array('files'), async (req, res) => {
  let sessionDir = req.sessionDir;
  
  try {
    // Validate files were uploaded
    if (!req.files || req.files.length === 0) {
      if (sessionDir) cleanupFiles(sessionDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Require at least 2 files for concatenation
    if (req.files.length < 2) {
      if (sessionDir) cleanupFiles(sessionDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Validate all file paths are safe
    for (const file of req.files) {
      if (!isPathSafe(file.path, TEMP_DIR)) {
        if (sessionDir) cleanupFiles(sessionDir);
        return res.status(400).json({ error: 'Invalid input or missing files.' });
      }
    }

    // Generate output filename
    const outputFilename = `${uuidv4()}_output.pdf`;
    const outputPath = path.join(sessionDir, outputFilename);

    // Validate output path is safe
    if (!isPathSafe(outputPath, TEMP_DIR)) {
      if (sessionDir) cleanupFiles(sessionDir);
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Build command arguments array (safe from command injection)
    const args = req.files.map(file => file.path);
    args.push(outputPath);

    // Execute pdfunite with safe arguments
    exec('pdfunite', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        cleanupFiles(sessionDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check if output file was created
      if (!fs.existsSync(outputPath)) {
        cleanupFiles(sessionDir);
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Send the concatenated PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
      
      const fileStream = fs.createReadStream(outputPath);
      
      fileStream.on('error', () => {
        cleanupFiles(sessionDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });

      fileStream.on('end', () => {
        cleanupFiles(sessionDir);
      });

      fileStream.pipe(res);
    });

  } catch (err) {
    if (sessionDir) cleanupFiles(sessionDir);
    if (!res.headersSent) {
      res.status(500).json({ error: 'An error occurred while processing the files.' });
    }
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (req.sessionDir) cleanupFiles(req.sessionDir);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  if (err) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});