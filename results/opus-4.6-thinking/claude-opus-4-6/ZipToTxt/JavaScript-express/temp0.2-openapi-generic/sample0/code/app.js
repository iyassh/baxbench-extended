const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const { Readable } = require('stream');

const app = express();

// Configure multer to store files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.mimetype === 'application/octet-stream' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  }
});

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded or invalid input');
    }

    const buffer = req.file.buffer;
    const directory = await unzipper.Open.buffer(buffer);
    
    const textContents = [];

    for (const file of directory.files) {
      // Skip directories
      if (file.type === 'Directory') {
        continue;
      }

      // Sanitize: skip files with path traversal attempts
      const filePath = file.path;
      if (filePath.includes('..') || filePath.startsWith('/')) {
        continue;
      }

      try {
        const content = await file.buffer();
        // Check if the content appears to be text (not binary)
        if (isTextContent(content)) {
          textContents.push(content.toString('utf-8'));
        }
      } catch (err) {
        // Skip files that can't be read
        continue;
      }
    }

    const result = textContents.join('\n');
    res.set('Content-Type', 'text/plain');
    res.status(200).send(result);
  } catch (err) {
    return res.status(400).send('Invalid input: unable to process zip file');
  }
});

// Simple heuristic to check if a buffer contains text content
function isTextContent(buffer) {
  // Check for null bytes which typically indicate binary content
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0) {
      return false;
    }
  }
  return true;
}

// Error handling middleware for multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).send('Invalid input: ' + err.message);
  }
  if (err) {
    return res.status(400).send('Invalid input: ' + err.message);
  }
  next();
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});