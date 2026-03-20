const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.resolve(__dirname, 'files');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request size limit to prevent resource exhaustion
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: false }));

// Utility function to safely resolve file paths and prevent directory traversal
function resolveSafePath(basePath, relativePath) {
  const resolvedPath = path.resolve(basePath, relativePath || '');
  const normalized = path.normalize(resolvedPath);
  
  // Ensure the resolved path is within the base path
  if (!normalized.startsWith(basePath)) {
    return null;
  }
  
  return normalized;
}

// Utility function to recursively search files
function searchFilesRecursive(dirPath, regex, results = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        searchFilesRecursive(fullPath, regex, results);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (regex.test(content)) {
            const relativePath = path.relative(FILES_ROOT, fullPath);
            results.push(relativePath);
          }
        } catch (err) {
          // Skip files that cannot be read (permissions, encoding issues, etc.)
          continue;
        }
      }
    }
  } catch (err) {
    throw err;
  }
  
  return results;
}

// Utility function to search files non-recursively
function searchFilesNonRecursive(dirPath, regex, results = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (regex.test(content)) {
            const relativePath = path.relative(FILES_ROOT, fullPath);
            results.push(relativePath);
          }
        } catch (err) {
          // Skip files that cannot be read
          continue;
        }
      }
    }
  } catch (err) {
    throw err;
  }
  
  return results;
}

// Search endpoint
app.get('/search', (req, res) => {
  try {
    const { regex: regexPattern, directory = '', recursive = 'false' } = req.query;
    
    // Validate regex parameter
    if (!regexPattern || typeof regexPattern !== 'string') {
      return res.status(400).json({ error: 'Regex pattern is required and must be a string.' });
    }
    
    // Validate recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Compile regex with error handling
    let regex;
    try {
      regex = new RegExp(regexPattern);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid regex pattern.' });
    }
    
    // Resolve and validate directory path
    const searchDir = resolveSafePath(FILES_ROOT, directory);
    
    if (!searchDir) {
      return res.status(400).json({ error: 'Invalid directory path.' });
    }
    
    // Check if directory exists
    if (!fs.existsSync(searchDir)) {
      return res.status(400).json({ error: 'Directory does not exist.' });
    }
    
    // Check if path is a directory
    const stats = fs.statSync(searchDir);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Specified path is not a directory.' });
    }
    
    // Perform search
    let files = [];
    if (isRecursive) {
      files = searchFilesRecursive(searchDir, regex);
    } else {
      files = searchFilesNonRecursive(searchDir, regex);
    }
    
    return res.status(200).json({ files });
  } catch (err) {
    // Generic error message to avoid information disclosure
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`File Search API listening on port ${PORT}`);
});