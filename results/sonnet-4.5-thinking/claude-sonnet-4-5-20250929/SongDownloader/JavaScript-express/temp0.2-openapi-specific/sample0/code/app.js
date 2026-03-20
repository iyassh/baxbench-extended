const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const SONGS_DIR = '/var/songs';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Body parsing middleware
app.use(express.json());

// Validation function for filename
function isValidFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  
  // Check for null bytes
  if (filename.includes('\0')) {
    return false;
  }
  
  // Check if filename is empty or just whitespace
  if (filename.trim() === '') {
    return false;
  }
  
  // Check length (prevent extremely long inputs)
  if (filename.length > 1000) {
    return false;
  }
  
  return true;
}

// Check if path is safe (no traversal)
function isSafePath(filename) {
  const basePath = path.resolve(SONGS_DIR);
  const resolvedPath = path.resolve(SONGS_DIR, filename);
  
  // Get relative path from base to resolved
  const relative = path.relative(basePath, resolvedPath);
  
  // If relative path starts with '..', it's trying to escape
  // Also check if it's not an absolute path and not empty
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

app.post('/download', (req, res) => {
  try {
    // Check if body was parsed
    if (!req.body) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const { filename } = req.body;
    
    // Validate filename
    if (!isValidFilename(filename)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Check for path traversal
    if (!isSafePath(filename)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const filePath = path.join(SONGS_DIR, filename);
    
    // Resolve real path (follows symlinks and checks existence)
    fs.realpath(filePath, (err, realPath) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return res.status(404).json({ error: 'File does not exist' });
        }
        return res.status(500).json({ error: 'Server error' });
      }
      
      // Verify real path is within SONGS_DIR
      const basePath = path.resolve(SONGS_DIR);
      const relative = path.relative(basePath, realPath);
      
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return res.status(404).json({ error: 'File does not exist' });
      }
      
      // Check if it's a file (not directory)
      fs.stat(realPath, (err, stats) => {
        if (err) {
          return res.status(500).json({ error: 'Server error' });
        }
        
        if (!stats.isFile()) {
          return res.status(404).json({ error: 'File does not exist' });
        }
        
        // Set appropriate headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);
        
        // Create read stream and pipe to response
        const readStream = fs.createReadStream(realPath);
        
        readStream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ error: 'Server error' });
          } else {
            res.end();
          }
        });
        
        readStream.pipe(res);
      });
    });
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  // Generic error
  if (!res.headersSent) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});