const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const DATA_DIR = '/data';

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Function to safely resolve path and prevent path traversal (CWE-22)
function safeResolvePath(baseDir, userPath) {
  if (!userPath || userPath === null || userPath === '') {
    return baseDir;
  }
  
  // Remove any leading slashes to treat as relative path
  const sanitizedPath = userPath.replace(/^\/+/, '');
  
  // Resolve the full path
  const fullPath = path.resolve(baseDir, sanitizedPath);
  
  // Normalize both paths for comparison
  const normalizedBase = path.normalize(baseDir);
  const normalizedFull = path.normalize(fullPath);
  
  // Ensure the resolved path is within the base directory
  if (normalizedFull !== normalizedBase && !normalizedFull.startsWith(normalizedBase + path.sep)) {
    throw new Error('Invalid path');
  }
  
  return normalizedFull;
}

// Function to search files recursively
function searchFiles(dir, searchContent, searchFilename) {
  const results = [];
  
  try {
    const entries = fs.readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      
      try {
        // Get the real path (resolves symlinks) and check it's within DATA_DIR
        const realPath = fs.realpathSync(fullPath);
        const normalizedBase = path.normalize(DATA_DIR);
        const normalizedReal = path.normalize(realPath);
        if (normalizedReal !== normalizedBase && !normalizedReal.startsWith(normalizedBase + path.sep)) {
          continue;
        }
        
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
          // Recursively search subdirectories
          const subResults = searchFiles(fullPath, searchContent, searchFilename);
          results.push(...subResults);
        } else if (stats.isFile()) {
          let matches = false;
          
          // Check filename match
          if (searchFilename && entry.startsWith(searchFilename)) {
            matches = true;
          }
          
          // Check content match
          if (searchContent && !matches) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              if (content.includes(searchContent)) {
                matches = true;
              }
            } catch (err) {
              // Skip files that can't be read as text (CWE-703)
              continue;
            }
          }
          
          if (matches) {
            results.push(fullPath);
          }
        }
      } catch (err) {
        // Skip files/directories that can't be accessed (CWE-703)
        continue;
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read (CWE-703)
  }
  
  return results;
}

// POST /search endpoint
app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Validate input types
    if (search_content !== null && search_content !== undefined && typeof search_content !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (search_filename !== null && search_filename !== undefined && typeof search_filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (search_dir !== null && search_dir !== undefined && typeof search_dir !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate input - at least one search criterion must be provided
    if (!search_content && !search_filename) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Safely resolve the search directory (CWE-22)
    let searchPath;
    try {
      searchPath = safeResolvePath(DATA_DIR, search_dir);
    } catch (err) {
      // Don't leak internal path information (CWE-209)
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Check if search path exists
    if (!fs.existsSync(searchPath)) {
      return res.status(200).json({ files: [] });
    }
    
    // Check if it's a directory
    try {
      const stats = fs.statSync(searchPath);
      if (!stats.isDirectory()) {
        return res.status(200).json({ files: [] });
      }
    } catch (err) {
      // Can't access path (CWE-703)
      return res.status(200).json({ files: [] });
    }
    
    // Perform the search
    const files = searchFiles(searchPath, search_content, search_filename);
    
    return res.status(200).json({ files });
    
  } catch (err) {
    // Generic error handling without leaking sensitive info (CWE-209, CWE-703)
    return res.status(500).json({ error: 'An error occurred' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  // Don't leak error details
  res.status(500).json({ error: 'An error occurred' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});