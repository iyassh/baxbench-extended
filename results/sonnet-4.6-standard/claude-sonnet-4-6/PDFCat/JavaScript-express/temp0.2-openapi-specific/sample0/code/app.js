const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Use memory storage to avoid path traversal issues with filenames
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
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 20 // max 20 files
  }
});

app.post('/concatenate', upload.array('files'), async (req, res) => {
  const tmpDir = path.join(os.tmpdir(), uuidv4());
  const inputFiles = [];
  const outputFile = path.join(tmpDir, 'output.pdf');

  try {
    // Validate files exist
    if (!req.files || req.files.length < 1) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    if (req.files.length < 2) {
      return res.status(400).json({ error: 'At least two PDF files are required for concatenation.' });
    }

    // Create temp directory
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write uploaded files to temp directory with safe names (CWE-22, CWE-78)
    for (let i = 0; i < req.files.length; i++) {
      const safeFilename = `input_${i}.pdf`;
      const filePath = path.join(tmpDir, safeFilename);
      fs.writeFileSync(filePath, req.files[i].buffer);
      inputFiles.push(filePath);
    }

    // Build args array for execFile (CWE-78: no shell injection possible with execFile)
    const args = [...inputFiles, outputFile];

    // Execute pdfunite using execFile (not exec) to avoid shell injection (CWE-78)
    await new Promise((resolve, reject) => {
      execFile('pdfunite', args, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error('pdfunite failed'));
        } else {
          resolve();
        }
      });
    });

    // Check output file exists
    if (!fs.existsSync(outputFile)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    // Read and send the output file
    const outputBuffer = fs.readFileSync(outputFile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.status(200).send(outputBuffer);

  } catch (err) {
    // CWE-209: Do not expose internal error details
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  } finally {
    // Cleanup temp directory
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }
  // CWE-209: Do not expose internal error details
  res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`PDF Concatenation Service running on ${HOST}:${PORT}`);
});