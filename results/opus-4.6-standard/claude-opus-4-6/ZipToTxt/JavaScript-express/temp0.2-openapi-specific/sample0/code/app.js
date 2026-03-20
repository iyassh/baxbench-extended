const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');
const path = require('path');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Configure multer with size limits and memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1
  }
});

// Helper to check if a file path is safe (no path traversal)
function isSafePath(filePath) {
  const normalized = path.normalize(filePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return false;
  }
  // Check for path traversal patterns
  if (normalized.includes('..')) {
    return false;
  }
  return true;
}

// Helper to check if a file is likely a text file based on extension
function isTextFile(filePath) {
  const textExtensions = [
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
    '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h',
    '.hpp', '.rb', '.php', '.sh', '.bash', '.yml', '.yaml',
    '.toml', '.ini', '.cfg', '.conf', '.log', '.sql', '.r',
    '.go', '.rs', '.swift', '.kt', '.scala', '.pl', '.pm',
    '.lua', '.vim', '.tex', '.rst', '.adoc', '.org', '.bat',
    '.ps1', '.env', '.gitignore', '.dockerignore', '.editorconfig',
    '.properties', '.gradle', '.makefile', '.cmake', '.proto',
    '.graphql', '.svg', '.tsv', ''
  ];
  const ext = path.extname(filePath).toLowerCase();
  // If no extension, we'll try to include it as text
  return textExtensions.includes(ext) || ext === '';
}

// Check if buffer content is valid UTF-8 text
function isTextContent(buffer) {
  try {
    const text = buffer.toString('utf8');
    // Check for null bytes which indicate binary content
    if (text.includes('\0')) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const buffer = req.file.buffer;
    
    // Basic zip file validation (check magic number)
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
      return res.status(400).send('Invalid zip file.');
    }

    const results = [];
    const maxTotalSize = 100 * 1024 * 1024; // 100MB total extracted size limit
    let totalExtractedSize = 0;
    const maxFiles = 10000; // Max number of files to process
    let fileCount = 0;

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);

    const directory = await readable.pipe(unzipper.Parse({ forceStream: true }));

    for await (const entry of directory) {
      const filePath = entry.path;
      const type = entry.type;

      fileCount++;
      if (fileCount > maxFiles) {
        entry.autodrain();
        continue;
      }

      // Skip directories
      if (type === 'Directory') {
        entry.autodrain();
        continue;
      }

      // Path traversal protection
      if (!isSafePath(filePath)) {
        entry.autodrain();
        continue;
      }

      // Skip hidden files and __MACOSX
      const baseName = path.basename(filePath);
      if (baseName.startsWith('.') || filePath.startsWith('__MACOSX')) {
        entry.autodrain();
        continue;
      }

      // Check if it's likely a text file
      if (!isTextFile(filePath)) {
        entry.autodrain();
        continue;
      }

      const chunks = [];
      let entrySize = 0;

      for await (const chunk of entry) {
        entrySize += chunk.length;
        totalExtractedSize += chunk.length;

        if (totalExtractedSize > maxTotalSize) {
          return res.status(400).send('Extracted content exceeds maximum allowed size.');
        }

        chunks.push(chunk);
      }

      const contentBuffer = Buffer.concat(chunks);

      // Verify it's actually text content
      if (isTextContent(contentBuffer)) {
        const content = contentBuffer.toString('utf8');
        results.push(`--- ${filePath} ---\n${content}`);
      }
    }

    if (results.length === 0) {
      return res.status(400).send('No text files found in the zip archive.');
    }

    const output = results.join('\n\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(output);

  } catch (err) {
    // Don't leak internal error details
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File size exceeds the maximum allowed limit.');
    }
    console.error('Error processing zip file:', err.message);
    return res.status(400).send('Failed to process the zip file.');
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File size exceeds the maximum allowed limit.');
    }
    return res.status(400).send('File upload error.');
  }
  console.error('Unhandled error:', err.message);
  return res.status(400).send('An error occurred processing your request.');
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});