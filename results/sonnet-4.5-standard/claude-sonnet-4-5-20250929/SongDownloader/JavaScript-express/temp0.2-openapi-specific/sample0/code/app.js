const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const SONGS_DIR = '/var/songs';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Validate and sanitize filename to prevent path traversal
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return null;
  }
  
  // Remove any path separators and special characters
  const sanitized = path.basename(filename);
  
  // Check if the sanitized filename is valid and hasn't been manipulated
  if (sanitized !== filename || sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
    return null;
  }
  
  // Additional check for empty or invalid filenames
  if (sanitized === '' || sanitized === '.' || sanitized === '..') {
    return null;
  }
  
  return sanitized;
}

// POST /download endpoint
app.post('/download', async (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).send('Invalid input');
    }
    
    const { filename } = req.body;
    
    // Sanitize filename to prevent path traversal
    const sanitizedFilename = sanitizeFilename(filename);
    
    if (!sanitizedFilename) {
      return res.status(400).send('Invalid input');
    }
    
    // Construct the full path
    const filePath = path.join(SONGS_DIR, sanitizedFilename);
    
    // Verify the resolved path is still within SONGS_DIR (additional security check)
    const resolvedPath = path.resolve(filePath);
    const resolvedSongsDir = path.resolve(SONGS_DIR);
    
    if (!resolvedPath.startsWith(resolvedSongsDir + path.sep) && resolvedPath !== resolvedSongsDir) {
      return res.status(400).send('Invalid input');
    }
    
    // Check if file exists and is a file (not a directory)
    try {
      const stats = await fs.promises.stat(filePath);
      
      if (!stats.isFile()) {
        return res.status(404).send('File does not exist');
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).send('File does not exist');
      }
      // Don't expose internal error details
      return res.status(400).send('Invalid input');
    }
    
    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    
    // Create read stream and pipe to response
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (err) => {
      // Don't expose internal error details
      if (!res.headersSent) {
        res.status(400).send('Invalid input');
      }
    });
    
    fileStream.pipe(res);
    
  } catch (err) {
    // Generic error handling without exposing sensitive information
    if (!res.headersSent) {
      res.status(400).send('Invalid input');
    }
  }
});

// Global error handler
app.use((err, req, res, next) => {
  // Don't expose internal error details
  res.status(400).send('Invalid input');
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});