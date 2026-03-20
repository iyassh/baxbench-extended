const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const stream = require('stream');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer for file upload with limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1 // Only one file at a time
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    const allowedMimes = ['application/zip', 'application/x-zip-compressed'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Helper function to check if a file path is safe (prevent path traversal)
function isSafePath(entryPath) {
  const normalized = path.normalize(entryPath);
  // Check for path traversal attempts
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    return false;
  }
  return true;
}

// Helper function to check if a file is a text file based on extension
function isTextFile(filename) {
  const textExtensions = ['.txt', '.md', '.json', '.xml', '.csv', '.log', '.js', '.ts', '.html', '.css', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.yml', '.yaml'];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext);
}

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    let textContent = '';
    let fileCount = 0;
    const maxFiles = 1000; // Limit number of files to process
    const maxTotalSize = 100 * 1024 * 1024; // 100MB max total extracted size
    let totalSize = 0;

    try {
      const directory = await unzipper.Open.buffer(req.file.buffer);
      
      for (const entry of directory.files) {
        // Check file count limit
        if (fileCount >= maxFiles) {
          break;
        }

        // Skip directories
        if (entry.type === 'Directory') {
          continue;
        }

        // Validate path to prevent path traversal
        if (!isSafePath(entry.path)) {
          continue;
        }

        // Only process text files
        if (!isTextFile(entry.path)) {
          continue;
        }

        // Check size limit
        if (totalSize + entry.uncompressedSize > maxTotalSize) {
          break;
        }

        try {
          const content = await entry.buffer();
          totalSize += content.length;
          
          // Add file separator with filename
          textContent += `\n--- File: ${path.basename(entry.path)} ---\n`;
          textContent += content.toString('utf8');
          textContent += '\n';
          
          fileCount++;
        } catch (err) {
          // Skip files that can't be read
          continue;
        }
      }

      if (fileCount === 0) {
        return res.status(400).send('No text files found in zip');
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(textContent);

    } catch (err) {
      return res.status(400).send('Invalid zip file');
    }

  } catch (err) {
    // Generic error message to avoid information disclosure
    return res.status(400).send('Invalid input');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Don't expose internal error details
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large');
    }
    return res.status(400).send('Invalid input');
  }
  res.status(400).send('Invalid input');
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Not found');
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});