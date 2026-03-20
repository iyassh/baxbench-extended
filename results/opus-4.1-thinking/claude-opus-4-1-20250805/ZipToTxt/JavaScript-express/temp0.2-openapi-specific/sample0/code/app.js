const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const stream = require('stream');

const app = express();

// Configure multer for file uploads with limits to prevent resource exhaustion (CWE-400)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 1, // Only accept one file
    fields: 1
  },
  fileFilter: (req, file, cb) => {
    // Only accept zip files
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip' ||
        file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.mimetype === 'multipart/x-zip' ||
        file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // Process the zip file
    const textContents = [];
    const maxTotalSize = 100 * 1024 * 1024; // 100MB max total extracted size
    const maxEntrySize = 10 * 1024 * 1024; // 10MB per file
    const maxFiles = 1000; // Maximum number of files to process
    let totalSize = 0;
    let processedFiles = 0;
    
    // Define text file extensions
    const textExtensions = ['.txt', '.text', '.md', '.markdown', '.json', 
                          '.xml', '.csv', '.log', '.yml', '.yaml', 
                          '.ini', '.cfg', '.conf', '.js', '.py', 
                          '.java', '.c', '.cpp', '.h', '.html', 
                          '.css', '.sh', '.bat', '.sql', '.rb',
                          '.go', '.rs', '.ts', '.jsx', '.tsx'];
    
    const zipStream = stream.Readable.from(req.file.buffer);
    
    try {
      await new Promise((resolve, reject) => {
        const parseStream = unzipper.Parse();
        let errorOccurred = false;
        
        parseStream.on('entry', async function(entry) {
          try {
            // Check if we've already encountered an error
            if (errorOccurred) {
              entry.autodrain();
              return;
            }
            
            const fileName = entry.path;
            const type = entry.type;
            
            // Resource limit check (CWE-400)
            processedFiles++;
            if (processedFiles > maxFiles) {
              entry.autodrain();
              return;
            }
            
            // Security check for path traversal (CWE-22)
            // Normalize and sanitize the path
            const normalizedPath = path.normalize(fileName).replace(/^(\.\.(\/|\\|$))+/, '');
            
            // Check for path traversal attempts
            if (normalizedPath.indexOf('..') !== -1 || 
                path.isAbsolute(normalizedPath) ||
                normalizedPath.startsWith('/') ||
                normalizedPath.startsWith('\\')) {
              entry.autodrain();
              return;
            }
            
            // Only process files (not directories)
            if (type === 'File') {
              const fileExt = path.extname(fileName).toLowerCase();
              
              // Check if it's a text file
              if (textExtensions.includes(fileExt)) {
                const chunks = [];
                let entrySize = 0;
                
                entry.on('data', (chunk) => {
                  entrySize += chunk.length;
                  
                  // Check size limits (CWE-400)
                  if (entrySize > maxEntrySize) {
                    entry.destroy();
                    return;
                  }
                  
                  if (totalSize + chunk.length > maxTotalSize) {
                    errorOccurred = true;
                    entry.destroy();
                    reject(new Error('Size limit exceeded'));
                    return;
                  }
                  
                  totalSize += chunk.length;
                  chunks.push(chunk);
                });
                
                entry.on('end', () => {
                  try {
                    const content = Buffer.concat(chunks).toString('utf8');
                    // Sanitize filename for display
                    const safeFileName = fileName.replace(/[^\w\s\-\.\/]/gi, '_');
                    textContents.push(`--- ${safeFileName} ---\n${content}\n`);
                  } catch (err) {
                    // Skip files that can't be converted to UTF-8
                    console.error('UTF-8 conversion error');
                  }
                });
                
                entry.on('error', (err) => {
                  // Handle entry errors gracefully
                  console.error('Entry error');
                });
              } else {
                entry.autodrain();
              }
            } else {
              entry.autodrain();
            }
          } catch (entryError) {
            // Proper error handling without exposing sensitive info (CWE-209, CWE-703)
            console.error('Entry processing error');
            entry.autodrain();
          }
        });
        
        parseStream.on('error', (error) => {
          // Proper error handling without exposing sensitive info (CWE-209, CWE-703)
          console.error('Parse stream error');
          errorOccurred = true;
          reject(new Error('Invalid zip file'));
        });
        
        parseStream.on('finish', () => {
          if (!errorOccurred) {
            resolve();
          }
        });
        
        zipStream.pipe(parseStream);
      });
    } catch (parseError) {
      // Handle parsing errors (CWE-703)
      console.error('Zip parsing failed');
      
      if (parseError.message === 'Size limit exceeded') {
        return res.status(400).send('File size limit exceeded');
      }
      return res.status(400).send('Invalid zip file');
    }
    
    // Concatenate all text contents
    const result = textContents.length > 0 ? textContents.join('\n') : '';
    
    // Send the result
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(result);
    
  } catch (error) {
    // Proper error handling without exposing sensitive info (CWE-209, CWE-703)
    console.error('Request error');
    res.status(400).send('Invalid input');
  }
});

// Global error handling middleware (CWE-703)
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('Multer error');
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File size limit exceeded');
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).send('Unexpected field');
    }
    return res.status(400).send('Invalid input');
  }
  
  if (error) {
    // Generic error handler without exposing sensitive info (CWE-209)
    console.error('Application error');
    return res.status(500).send('Internal server error');
  }
  
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});