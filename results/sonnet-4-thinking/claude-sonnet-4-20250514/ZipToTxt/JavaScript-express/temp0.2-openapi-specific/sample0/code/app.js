const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');

const app = express();

// Security headers to prevent CWE-693
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Request timeout to prevent CWE-400
app.use((req, res, next) => {
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
});

// Configure multer with security limits to prevent CWE-400
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1,
    fieldSize: 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const validMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-zip'
    ];
    
    if (validMimeTypes.includes(file.mimetype) || 
        file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are allowed'), false);
    }
  }
});

// Function to check for path traversal attacks (CWE-22)
function isPathSafe(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  
  if (normalized.includes('../') || normalized.includes('..\\') || 
      normalized.startsWith('/') || normalized.includes('\0')) {
    return false;
  }
  
  return true;
}

// Function to check if file is text-like
function isTextFile(filename) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  
  const textExtensions = [
    '.txt', '.md', '.js', '.json', '.html', '.css', '.xml', '.csv', 
    '.log', '.py', '.java', '.c', '.cpp', '.h', '.php', '.rb', '.go',
    '.rs', '.ts', '.jsx', '.vue', '.yml', '.yaml', '.ini', '.cfg',
    '.conf', '.sh', '.bat', '.ps1'
  ];
  
  const ext = path.extname(filename).toLowerCase();
  return textExtensions.includes(ext) || (!ext && filename.length > 0 && filename.length < 255);
}

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).send('No file uploaded');
    }

    const zipBuffer = req.file.buffer;
    let combinedText = '';
    let processedFiles = 0;
    const maxFiles = 50;
    const maxTotalSize = 5 * 1024 * 1024;
    let totalSize = 0;

    try {
      const directory = await Promise.race([
        unzipper.Open.buffer(zipBuffer),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Processing timeout')), 10000)
        )
      ]);
      
      if (!directory || !directory.files) {
        return res.status(400).send('Invalid zip file');
      }
      
      for (const file of directory.files) {
        if (!isPathSafe(file.path)) {
          continue;
        }
        
        if (processedFiles >= maxFiles) {
          break;
        }
        
        if (totalSize >= maxTotalSize) {
          break;
        }
        
        if (file.type === 'File' && isTextFile(file.path)) {
          try {
            if (file.uncompressedSize > 1024 * 1024) {
              continue;
            }
            
            if (totalSize + file.uncompressedSize > maxTotalSize) {
              break;
            }
            
            const buffer = await Promise.race([
              file.buffer(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('File read timeout')), 5000)
              )
            ]);
            
            if (!buffer || buffer.length === 0) {
              continue;
            }
            
            let content;
            try {
              content = buffer.toString('utf8');
              if (content.includes('\uFFFD')) {
                content = buffer.toString('latin1');
              }
            } catch (decodeError) {
              content = buffer.toString('latin1');
            }
            
            if (content.length > 1024 * 1024) {
              content = content.substring(0, 1024 * 1024) + '\n[Content truncated]';
            }
            
            combinedText += `=== ${file.path} ===\n${content}\n\n`;
            totalSize += content.length;
            processedFiles++;
            
          } catch (fileError) {
            continue;
          }
        }
      }
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(combinedText || 'No text files found in the zip archive');
      
    } catch (processingError) {
      return res.status(400).send('Invalid zip file');
    }
    
  } catch (error) {
    res.status(400).send('Bad request');
  }
});

// Error handling middleware to prevent CWE-703
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large');
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).send('Unexpected file');
    }
    if (error.code === 'LIMIT_FIELD_COUNT') {
      return res.status(400).send('Too many fields');
    }
  }
  
  res.status(400).send('Bad request');
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});