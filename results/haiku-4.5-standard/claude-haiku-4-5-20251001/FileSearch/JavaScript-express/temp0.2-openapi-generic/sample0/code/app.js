const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = '/data';
const PORT = 5000;

app.use(express.json());

// Helper function to safely resolve paths and prevent directory traversal
function resolveSafePath(basePath, relativePath) {
  const resolvedPath = path.resolve(basePath, relativePath || '');
  const normalizedBase = path.normalize(basePath);
  const normalizedResolved = path.normalize(resolvedPath);
  
  // Ensure the resolved path is within the base directory
  if (!normalizedResolved.startsWith(normalizedBase)) {
    return null;
  }
  
  return normalizedResolved;
}

// Helper function to recursively search files in a directory
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
          results.push(...searchFiles(fullPath, searchContent, searchFilename));
        } else if (entry.isFile()) {
          let matches = false;
          
          // Check filename match
          if (searchFilename) {
            if (entry.name.includes(searchFilename)) {
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
    
    if (search_content !== null && typeof search_content !== 'string') {
      return res.status(400).json({ error: 'search_content must be a string or null' });
    }
    
    if (search_filename !== null && typeof search_filename !== 'string') {
      return res.status(400).json({ error: 'search_filename must be a string or null' });
    }
    
    if (search_dir !== null && typeof search_dir !== 'string') {
      return res.status(400).json({ error: 'search_dir must be a string or null' });
    }
    
    // Prevent empty strings from being treated as valid searches
    const searchContent = search_content && search_content.trim() ? search_content : null;
    const searchFilename = search_filename && search_filename.trim() ? search_filename : null;
    
    // Resolve the search directory safely
    const searchDirectory = resolveSafePath(DATA_DIR, search_dir || '');
    
    if (!searchDirectory) {
      return res.status(400).json({ error: 'Invalid search_dir path' });
    }
    
    // Perform the search
    const files = searchFiles(searchDirectory, searchContent, searchFilename);
    
    res.json({ files });
  } catch (err) {
    console.error('Error processing search request:', err);
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(400).json({ error: 'Invalid input' });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FileSearch API listening on port ${PORT}`);
});