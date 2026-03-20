const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer for file uploads with security constraints
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  },
});

// Helper function to check if a path is safe (prevents directory traversal)
function isSafePath(filePath) {
  const normalized = path.normalize(filePath);
  return !normalized.startsWith('..') && !path.isAbsolute(normalized);
}

// Helper function to check if file is a text file
function isTextFile(fileName) {
  const textExtensions = [
    '.txt', '.md', '.json', '.xml', '.csv', '.log', '.yaml', '.yml',
    '.html', '.htm', '.css', '.js', '.ts', '.py', '.java', '.cpp',
    '.c', '.h', '.sh', '.bash', '.sql', '.conf', '.config', '.ini',
    '.properties', '.gradle', '.maven', '.pom', '.dockerfile', '.env'
  ];
  const ext = path.extname(fileName).toLowerCase();
  return textExtensions.includes(ext) || !path.extname(fileName);
}

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Validate file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const fileBuffer = req.file.buffer;
    const textContents = [];
    let fileCount = 0;
    const maxFiles = 1000; // Prevent resource exhaustion

    // Process the zip file
    const stream = require('stream').Readable.from(fileBuffer);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(unzipper.Parse())
        .on('entry', (entry) => {
          const fileName = entry.path;
          const type = entry.type; // 'File' or 'Directory'

          // Security: Check for directory traversal attacks
          if (!isSafePath(fileName)) {
            entry.autodrain();
            return;
          }

          // Prevent resource exhaustion
          if (fileCount >= maxFiles) {
            entry.autodrain();
            return;
          }

          // Only process files (not directories)
          if (type === 'File' && isTextFile(fileName)) {
            fileCount++;
            let content = '';

            entry.on('data', (chunk) => {
              // Limit individual file size to prevent memory exhaustion
              if (content.length + chunk.length > 10 * 1024 * 1024) {
                entry.autodrain();
                return;
              }
              content += chunk.toString('utf-8', 0, chunk.length);
            });

            entry.on('end', () => {
              textContents.push(`\n--- File: ${fileName} ---\n${content}`);
            });

            entry.on('error', (err) => {
              // Silently skip files that can't be read
              entry.autodrain();
            });
          } else {
            entry.autodrain();
          }
        })
        .on('error', (err) => {
          reject(new Error('Failed to process zip file'));
        })
        .on('finish', () => {
          resolve();
        });
    });

    // Return the concatenated text
    const result = textContents.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(result);

  } catch (error) {
    // Don't expose internal error details
    console.error('Error processing zip file:', error.message);
    res.status(400).send('Invalid zip file or processing error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  
  // Don't expose internal error details
  if (err.message.includes('File too large')) {
    return res.status(400).send('File too large');
  }
  
  if (err.message.includes('Only zip files')) {
    return res.status(400).send('Only zip files are allowed');
  }
  
  res.status(400).send('Invalid request');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ZipToTxt API server running on http://0.0.0.0:${PORT}`);
});