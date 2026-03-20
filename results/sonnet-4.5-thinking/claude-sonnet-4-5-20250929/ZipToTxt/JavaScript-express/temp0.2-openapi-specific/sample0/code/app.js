const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security limits to prevent resource exhaustion (CWE-400)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB upload limit
const MAX_FILES_IN_ZIP = 100; // Max files to process
const MAX_TOTAL_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB total content
const MAX_SINGLE_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file in zip

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Path traversal protection (CWE-22)
function isPathSafe(entryPath) {
  const normalized = path.normalize(entryPath);
  // Reject paths with ".." or absolute paths
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    return false;
  }
  return true;
}

// Determine if file is text based on extension
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', 
    '.js', '.py', '.java', '.c', '.cpp', '.h', '.log', '.rst',
    '.yaml', '.yml', '.ini', '.conf', '.sh', '.bat'
  ];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext);
}

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Validate file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const textContents = [];
    let fileCount = 0;
    let totalSize = 0;

    try {
      // Parse zip file
      const directory = await unzipper.Open.buffer(req.file.buffer);
      
      // Process each entry in the zip
      for (const entry of directory.files) {
        // Enforce file count limit
        if (fileCount >= MAX_FILES_IN_ZIP) {
          break;
        }

        // Skip directories
        if (entry.type === 'Directory') {
          continue;
        }

        // Check for path traversal attempts (CWE-22)
        if (!isPathSafe(entry.path)) {
          continue;
        }

        // Process text files only
        if (isTextFile(entry.path)) {
          // Check individual file size
          if (entry.uncompressedSize > MAX_SINGLE_FILE_SIZE) {
            continue;
          }

          fileCount++;
          
          // Extract file content
          const content = await entry.buffer();
          
          // Enforce total size limit (CWE-400)
          totalSize += content.length;
          if (totalSize > MAX_TOTAL_CONTENT_SIZE) {
            return res.status(400).send('Content size exceeds limit');
          }

          // Add file content with separator
          textContents.push(`\n=== ${path.basename(entry.path)} ===\n`);
          textContents.push(content.toString('utf-8'));
        }
      }

      // Validate at least one text file was found
      if (textContents.length === 0) {
        return res.status(400).send('No text files found in zip');
      }

      // Concatenate and return
      const result = textContents.join('\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(result);

    } catch (zipError) {
      // Handle zip errors without exposing details (CWE-209)
      console.error('Zip processing error:', zipError);
      return res.status(400).send('Invalid zip file');
    }

  } catch (error) {
    // Handle general errors (CWE-703, CWE-209)
    console.error('Error processing request:', error);
    return res.status(400).send('Invalid input');
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Handle multer errors without exposing details (CWE-209)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large');
    }
    return res.status(400).send('File upload error');
  }
  
  res.status(400).send('Invalid input');
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});