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
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Limit upload size to 50MB (CWE-400)
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_UNZIPPED_SIZE = 100 * 1024 * 1024; // 100MB total unzipped content

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
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
      cb(new Error('Only zip files are allowed'));
    }
  },
});

// Helper: check if a file entry is a text file
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
    '.js', '.ts', '.css', '.yaml', '.yml', '.ini', '.cfg',
    '.log', '.sh', '.py', '.rb', '.java', '.c', '.cpp', '.h',
    '.cs', '.go', '.rs', '.php', '.sql', '.toml', '.env',
    '.bat', '.ps1', '.r', '.tex', '.rst', '.adoc',
  ];
  const lower = filename.toLowerCase();
  return textExtensions.some((ext) => lower.endsWith(ext));
}

// Helper: sanitize entry path to prevent path traversal (CWE-22)
function isSafePath(entryPath) {
  // Normalize and check for path traversal
  const normalized = entryPath.replace(/\\/g, '/');
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
      // Custom filter error
      return res.status(400).type('text/plain').send('Invalid input: only zip files are accepted.');
    }

    if (!req.file) {
      return res.status(400).type('text/plain').send('No file uploaded.');
    }

    try {
      const buffer = req.file.buffer;

      // Parse zip from buffer
      const readable = Readable.from(buffer);
      const directory = await unzipper.Open.buffer(buffer);

      let totalUnzippedSize = 0;
      const textChunks = [];

      // Limit number of files to process (CWE-400)
      const MAX_FILES = 1000;
      let fileCount = 0;

      for (const entry of directory.files) {
        // Skip directories
        if (entry.type === 'Directory') {
          continue;
        }

        fileCount++;
        if (fileCount > MAX_FILES) {
          // Stop processing further files
          break;
        }

        // Check for path traversal (CWE-22)
        if (!isSafePath(entry.path)) {
          continue;
        }

        // Only process text files
        if (!isTextFile(entry.path)) {
          continue;
        }

        // Read entry content with size limit
        const chunks = [];
        let entrySize = 0;

        await new Promise((resolve, reject) => {
          const stream = entry.stream();
          stream.on('data', (chunk) => {
            entrySize += chunk.length;
            totalUnzippedSize += chunk.length;

            if (entrySize > 10 * 1024 * 1024) {
              // Single file too large (10MB per file)
              stream.destroy(new Error('Single file too large'));
              return;
            }

            if (totalUnzippedSize > MAX_UNZIPPED_SIZE) {
              stream.destroy(new Error('Total unzipped content too large'));
              return;
            }

            chunks.push(chunk);
          });
          stream.on('end', resolve);
          stream.on('error', reject);
        });

        const content = Buffer.concat(chunks).toString('utf8');
        textChunks.push(`=== ${entry.path} ===\n${content}`);
      }

      if (textChunks.length === 0) {
        return res.status(200).type('text/plain').send('');
      }

      const result = textChunks.join('\n\n');
      return res.status(200).type('text/plain').send(result);
    } catch (error) {
      // CWE-209: Do not expose internal error details
      return res.status(400).type('text/plain').send('Failed to process zip file. Please ensure the file is a valid zip archive.');
    }
  });
});

// Handle unknown routes
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