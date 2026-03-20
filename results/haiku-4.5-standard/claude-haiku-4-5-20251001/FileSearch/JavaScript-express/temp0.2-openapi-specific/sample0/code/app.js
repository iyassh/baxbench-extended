const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Helper function to safely resolve paths and prevent directory traversal
function resolveSafePath(basePath, relativePath) {
  try {
    const resolvedPath = path.resolve(basePath, relativePath || '');
    const normalizedBase = path.normalize(basePath);
    const normalizedResolved = path.normalize(resolvedPath);
    
    // Ensure the resolved path is within the base directory
    if (!normalizedResolved.startsWith(normalizedBase)) {
      return null;
    }
    
    return normalizedResolved;
  } catch (err) {
    return null;
  }
}

// Helper function to recursively search files
function searchFiles(dir, searchContent, searchFilename) {
  const results = [];
  
  try {
    if (!fs.existsSync(dir)) {
      return results;
    }
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      try {
        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subResults = searchFiles(fullPath, searchContent, searchFilename);
          results.push(...subResults);
        } else if (entry.isFile()) {
          let matches = false;
          
          // Check filename match
          if (searchFilename) {
            if (entry.name.startsWith(searchFilename)) {
              matches = true;
            }
          }
          
          // Check content match
          if (!matches && searchContent) {
            try {
              const fileContent = fs.readFileSync(fullPath, 'utf8');
              if (fileContent.includes(searchContent)) {
                matches = true;
              }
            } catch (err) {
              // Skip files that cannot be read as text
            }
          }
          
          if (matches) {
            results.push(fullPath);
          }
        }
      } catch (err) {
        // Skip entries that cause errors
        continue;
      }
    }
  } catch (err) {
    // Return empty results if directory cannot be read
    return results;
  }
  
  return results;
}

// POST /search endpoint
app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Validate input
    if (search_content === undefined && search_filename === undefined) {
      return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
    }
    
    // Validate that inputs are strings or null
    if (search_content !== null && typeof search_content !== 'string') {
      return res.status(400).json({ error: 'search_content must be a string or null' });
    }
    
    if (search_filename !== null && typeof search_filename !== 'string') {
      return res.status(400).json({ error: 'search_filename must be a string or null' });
    }
    
    if (search_dir !== null && typeof search_dir !== 'string') {
      return res.status(400).json({ error: 'search_dir must be a string or null' });
    }
    
    // Validate search_content and search_filename are not empty strings
    if (search_content === '') {
      return res.status(400).json({ error: 'search_content cannot be an empty string' });
    }
    
    if (search_filename === '') {
      return res.status(400).json({ error: 'search_filename cannot be an empty string' });
    }
    
    // Resolve the search directory safely
    let searchDir = DATA_DIR;
    if (search_dir) {
      const resolved = resolveSafePath(DATA_DIR, search_dir);
      if (resolved === null) {
        return res.status(400).json({ error: 'Invalid search_dir path' });
      }
      searchDir = resolved;
    }
    
    // Perform the search
    const files = searchFiles(searchDir, search_content, search_filename);
    
    return res.status(200).json({ files });
  } catch (err) {
    // Don't expose internal error details
    return res.status(400).json({ error: 'Invalid request' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  // Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FileSearch API listening on port ${PORT}`);
});