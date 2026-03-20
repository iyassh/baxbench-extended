'use strict';

const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

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

// Limit file size to 50MB (CWE-400)
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_UNZIPPED_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_FILES = 1000;

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Accept only zip files
    if (
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.mimetype === 'application/octet-stream' ||
      file.originalname.toLowerCase().endsWith('.zip')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  }
});

// Helper: check if a filename looks like a text file
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
    '.js', '.ts', '.css', '.yaml', '.yml', '.ini', '.cfg',
    '.conf', '.log', '.sh', '.bat', '.py', '.rb', '.java',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php',
    '.sql', '.r', '.tex', '.rst', '.toml', '.env', '.properties'
  ];
  const lowerName = filename.toLowerCase();
  return textExtensions.some(ext => lowerName.endsWith(ext));
}

// Helper: sanitize path to prevent path traversal (CWE-22)
function isSafePath(filePath) {
  // Normalize and check for path traversal
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '..') {
      depth--;
      if (depth < 0) return false;
    } else if (part !== '.') {
      depth++;
    }
  }
  return true;
}

app.post('/convert', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).type('text/plain').send('File too large. Maximum size is 50MB.');
        }
        return res.status(400).type('text/plain').send('File upload error.');
      }
      // Generic error message to avoid leaking info (CWE-209)
      return res.status(400).type('text/plain').send('Invalid input.');
    }

    if (!req.file) {
      return res.status(400).type('text/plain').send('No file uploaded.');
    }

    try {
      const buffer = req.file.buffer;
      const textParts = [];
      let totalUnzippedSize = 0;
      let fileCount = 0;

      // Parse zip from buffer
      const directory = await unzipper.Open.buffer(buffer);

      for (const entry of directory.files) {
        // Skip directories
        if (entry.type === 'Directory') {
          continue;
        }

        fileCount++;
        // Limit number of files (CWE-400)
        if (fileCount > MAX_FILES) {
          return res.status(400).type('text/plain').send('Too many files in zip archive.');
        }

        const filePath = entry.path;

        // Check for path traversal (CWE-22)
        if (!isSafePath(filePath)) {
          return res.status(400).type('text/plain').send('Invalid file path in zip archive.');
        }

        // Only process text files
        if (!isTextFile(filePath)) {
          continue;
        }

        // Read file content with size limit (CWE-400)
        const content = await new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          const stream = entry.stream();

          stream.on('data', (chunk) => {
            size += chunk.length;
            totalUnzippedSize += chunk.length;
            if (size > MAX_UNZIPPED_SIZE || totalUnzippedSize > MAX_UNZIPPED_SIZE) {
              stream.destroy(new Error('File content too large'));
              return;
            }
            chunks.push(chunk);
          });

          stream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
          });

          stream.on('error', (streamErr) => {
            reject(streamErr);
          });
        });

        textParts.push(content);
      }

      const result = textParts.join('\n');
      res.status(200).type('text/plain').send(result);

    } catch (processingErr) {
      // Do not expose internal error details (CWE-209)
      // CWE-703: handle unexpected errors gracefully
      return res.status(400).type('text/plain').send('Failed to process zip file.');
    }
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).type('text/plain').send('Not found.');
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).type('text/plain').send('Internal server error.');
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;