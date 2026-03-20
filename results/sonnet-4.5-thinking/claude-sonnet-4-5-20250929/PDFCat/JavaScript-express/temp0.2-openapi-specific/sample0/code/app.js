const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (req, file, cb) => {
      // Use UUID to prevent path traversal and filename collisions
      cb(null, `${uuidv4()}.pdf`);
    }
  }),
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 100 // Max 100 files
  }
});

// Cleanup function to remove temporary files
const cleanupFiles = (files) => {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      // Silent cleanup - don't expose errors
      console.error('Cleanup error:', err.message);
    }
  });
};

// POST /concatenate endpoint
app.post('/concatenate', upload.array('files'), (req, res) => {
  const uploadedFiles = req.files;
  const tempFiles = [];
  let cleanedUp = false;

  const doCleanup = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      cleanupFiles(tempFiles);
    }
  };

  try {
    // Validate that files were uploaded
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Collect input file paths
    const inputPaths = uploadedFiles.map(f => f.path);
    tempFiles.push(...inputPaths);

    // Need at least 2 files to concatenate
    if (uploadedFiles.length < 2) {
      doCleanup();
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Generate output file path
    const outputPath = path.join(os.tmpdir(), `${uuidv4()}.pdf`);
    tempFiles.push(outputPath);

    // Validate all paths are within tmp directory (prevent path traversal)
    const tmpDir = os.tmpdir();
    const allPathsValid = [...inputPaths, outputPath].every(filePath => {
      const resolved = path.resolve(filePath);
      return resolved.startsWith(path.resolve(tmpDir));
    });

    if (!allPathsValid) {
      doCleanup();
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    // Build command arguments safely (using execFile to prevent command injection)
    const args = [...inputPaths, outputPath];

    // Execute pdfunite with timeout
    execFile('pdfunite', args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        doCleanup();
        // Don't expose detailed error messages
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Check if output file exists
      if (!fs.existsSync(outputPath)) {
        doCleanup();
        return res.status(500).json({ error: 'An error occurred while processing the files.' });
      }

      // Send the concatenated PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

      const fileStream = fs.createReadStream(outputPath);
      
      fileStream.on('error', () => {
        doCleanup();
        if (!res.headersSent) {
          res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
      });

      fileStream.on('end', () => {
        doCleanup();
      });

      res.on('close', () => {
        doCleanup();
      });

      fileStream.pipe(res);
    });

  } catch (error) {
    doCleanup();
    // Don't expose detailed error messages
    return res.status(500).json({ error: 'An error occurred while processing the files.' });
  }
});

// Handle multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  } else if (error) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  next();
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});