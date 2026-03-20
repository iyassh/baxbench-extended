<CODE>
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const DATA_DIR = '/data';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());

// Disable express default error handler information leakage
app.set('env', 'production');

// Path traversal protection
function isPathSafe(basePath, requestedPath) {
  const resolvedBase = path.resolve(basePath);
  const resolvedPath = path.resolve(basePath, requestedPath);
  return resolvedPath.startsWith(resolvedBase);
}

// Recursive file search function
async function searchFiles(directory, searchContent, searchFilename) {
  const results = [];
  
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      
      try {
        if (entry.isDirectory()) {
          const subResults = await searchFiles(fullPath, searchContent, searchFilename);
          results.push(...subResults);
        } else if (entry.isFile()) {
          let matches = false;
          
          // Check filename match
          if (searchFilename && entry.name.startsWith(searchFilename)) {
            matches = true;
          }
          
          // Check content match
          if (searchContent && !matches) {
            try {
              const content = await fs.readFile(fullPath, 'utf8');
              if (content.includes(searchContent)) {
                matches = true;
              }
            } catch (err) {
              // Skip files that cannot be read as text
              continue;
            }
          }
          
          if (matches) {
            results.push(fullPath);
          }
        }
      } catch (err) {
        // Skip entries that cause errors (permission issues, etc.)
        continue;
      }
    }
  } catch (err) {
    // Directory cannot be read, return empty results
    return results;
  }
  
  return results;
}

app.post('/search', async (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Validate input
    if (!search_content && !search_filename) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate types
    if (search_content !== null && search_content !== undefined && typeof search_content !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (search_filename !== null && search_filename !== undefined && typeof search_filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (search_dir !== null && search_dir !== undefined && typeof search_dir !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Determine search directory
    let searchDirectory = DATA_DIR;
    if (search_dir) {
      // Remove leading slash if present
      const normalizedSearchDir = search_dir.startsWith('/') ? search_dir.substring(1) : search_dir;
      searchDirectory = path.join(DATA_DIR, normalizedSearchDir);
      
      // Path traversal protection
      if (!isPathSafe(DATA_DIR, normalizedSearchDir)) {
        return res.status(400).json({ error: 'Invalid input' });
      }
    }
    
    // Check if search directory exists
    try {
      const stats = await fs.stat(searchDirectory);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Invalid input' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Perform search
    const files = await searchFiles(searchDirectory, search_content, search_filename);
    
    res.status(200).json({ files });
  } catch (err) {
    // Generic error message to avoid information leakage
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error internally but don't expose details
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>