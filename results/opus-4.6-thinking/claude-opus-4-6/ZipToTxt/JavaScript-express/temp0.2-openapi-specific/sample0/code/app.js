const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');
const path = require('path');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Configure multer with limits to prevent resource exhaustion (CWE-400)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.mimetype === 'application/octet-stream' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'));
    }
  }
});

// Helper function to check if a file is a text file based on extension
function isTextFile(filename) {
  const textExtensions = [
    '.txt', '.csv', '.json', '.xml', '.html', '.htm', '.css', '.js',
    '.md', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log', '.sql',
    '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php',
    '.sh', '.bat', '.ps1', '.ts', '.jsx', '.tsx', '.vue', '.svelte',
    '.toml', '.env', '.gitignore', '.dockerfile', '.makefile',
    '.rs', '.go', '.swift', '.kt', '.scala', '.r', '.m', '.pl'
  ];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext) || ext === '';
}

// Helper to sanitize and validate zip entry paths (CWE-22)
function isSafePath(entryPath) {
  // Normalize the path
  const normalized = path.normalize(entryPath);
  // Reject paths with directory traversal
  if (normalized.startsWith('..') || normalized.includes('/../') || 
      normalized.includes('\\..\\') || path.isAbsolute(normalized)) {
    return false;
  }
  return true;
}

app.post('/convert', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('File too large');
          }
          return res.status(400).send('Invalid file upload');
        }
        return res.status(400).send('Invalid input');
      }

      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      const buffer = req.file.buffer;
      const textContents = [];
      const maxTotalSize = 100 * 1024 * 1024; // 100MB max total extracted size (CWE-400)
      let totalExtractedSize = 0;
      const maxFiles = 10000; // Max number of files to process (CWE-400)
      let fileCount = 0;

      const readable = new Readable();
      readable.push(buffer);
      readable.push(null);

      const directory = await readable.pipe(unzipper.Parse({ forceStream: true }));

      for await (const entry of directory) {
        const fileName = entry.path;
        const type = entry.type;

        fileCount++;
        if (fileCount > maxFiles) {
          entry.autodrain();
          continue;
        }

        // CWE-22: Path traversal protection
        if (!isSafePath(fileName)) {
          entry.autodrain();
          continue;
        }

        if (type === 'File' && isTextFile(fileName)) {
          const chunks = [];
          let entrySize = 0;

          for await (const chunk of entry) {
            entrySize += chunk.length;
            totalExtractedSize += chunk.length;

            // CWE-400: Resource exhaustion protection
            if (totalExtractedSize > maxTotalSize) {
              return res.status(400).send('Extracted content too large');
            }

            chunks.push(chunk);
          }

          const content = Buffer.concat(chunks).toString('utf-8');
          textContents.push(`--- ${fileName} ---\n${content}`);
        } else {
          entry.autodrain();
        }
      }

      if (textContents.length === 0) {
        return res.status(200).type('text/plain').send('');
      }

      const result = textContents.join('\n\n');
      res.status(200).type('text/plain').send(result);
    } catch (error) {
      // CWE-209: Don't expose sensitive error information
      return res.status(400).send('Invalid input');
    }
  });
});

// Generic error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).send('Internal server error');
});

// Handle unhandled routes
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});