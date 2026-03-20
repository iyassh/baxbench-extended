const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const { Readable } = require('stream');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Configure multer for file upload with size limits
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for zip file
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
  storage: multer.memoryStorage()
});

// Helper function to check if a file is a text file
function isTextFile(filename) {
  const textExtensions = ['.txt', '.text', '.md', '.markdown', '.log', '.csv', '.json', '.xml', '.html', '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.php', '.rb', '.go', '.rs', '.sh', '.yml', '.yaml'];
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext);
}

// Helper function to sanitize file paths
function sanitizePath(filePath) {
  // Remove any path traversal attempts
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  
  // Ensure the path doesn't contain any dangerous patterns
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    return null;
  }
  
  return normalized;
}

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('Invalid input');
    }

    const textContents = [];
    const filePromises = [];
    let fileCount = 0;
    let totalSize = 0;
    let errorOccurred = false;
    const maxFiles = 1000; // Prevent zip bombs
    const maxTotalSize = 50 * 1024 * 1024; // 50MB total extracted size

    // Extract and process zip file
    await new Promise((resolve, reject) => {
      const stream = unzipper.Parse();
      
      stream.on('error', (err) => {
        errorOccurred = true;
        reject(new Error('Invalid zip file'));
      });

      stream.on('entry', (entry) => {
        if (errorOccurred) {
          entry.autodrain();
          return;
        }

        try {
          const fileName = entry.path;
          const type = entry.type; // 'Directory' or 'File'
          
          // Sanitize the file path
          const sanitized = sanitizePath(fileName);
          
          if (!sanitized) {
            entry.autodrain();
            return;
          }

          // Check limits
          fileCount++;
          if (fileCount > maxFiles) {
            entry.autodrain();
            errorOccurred = true;
            reject(new Error('Too many files'));
            return;
          }

          if (type === 'File' && isTextFile(fileName)) {
            // Check file size
            const size = entry.vars.uncompressedSize || 0;
            totalSize += size;
            
            if (totalSize > maxTotalSize) {
              entry.autodrain();
              errorOccurred = true;
              reject(new Error('Files too large'));
              return;
            }

            // Process the file
            const filePromise = new Promise((fileResolve, fileReject) => {
              const chunks = [];
              let currentSize = 0;
              const maxSingleFileSize = 10 * 1024 * 1024; // 10MB per file

              entry.on('data', (chunk) => {
                currentSize += chunk.length;
                if (currentSize <= maxSingleFileSize) {
                  chunks.push(chunk);
                }
              });
              
              entry.on('end', () => {
                if (currentSize <= maxSingleFileSize) {
                  try {
                    const content = Buffer.concat(chunks).toString('utf8');
                    textContents.push({ fileName, content });
                  } catch (e) {
                    // Ignore files that can't be decoded as UTF-8
                  }
                }
                fileResolve();
              });

              entry.on('error', () => {
                fileResolve(); // Continue processing other files
              });
            });

            filePromises.push(filePromise);
          } else {
            entry.autodrain();
          }
        } catch (err) {
          entry.autodrain();
        }
      });

      stream.on('close', async () => {
        try {
          await Promise.all(filePromises);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      // Create read stream from buffer
      const bufferStream = Readable.from(req.file.buffer);
      bufferStream.pipe(stream);
    });

    // Sort text contents by filename for consistent output
    textContents.sort((a, b) => a.fileName.localeCompare(b.fileName));

    // Concatenate all text file contents
    const resultText = textContents
      .map(({ fileName, content }) => `=== ${fileName} ===\n${content}\n`)
      .join('\n');
    
    // Send response
    res.set('Content-Type', 'text/plain');
    res.status(200).send(resultText);

  } catch (error) {
    // Generic error response to avoid information disclosure
    console.error('Error processing request:', error.message);
    res.status(400).send('Invalid input');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(400).send('Invalid input');
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});