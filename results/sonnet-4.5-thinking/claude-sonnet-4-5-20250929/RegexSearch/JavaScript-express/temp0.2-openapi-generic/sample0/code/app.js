const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const FILES_ROOT = path.join(__dirname, 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

// Helper function to normalize and validate directory path
function validateAndNormalizePath(directory) {
  if (!directory) {
    return FILES_ROOT;
  }
  
  const normalizedPath = path.normalize(directory);
  const fullPath = path.join(FILES_ROOT, normalizedPath);
  const resolvedPath = path.resolve(fullPath);
  const resolvedRoot = path.resolve(FILES_ROOT);
  
  // Prevent directory traversal
  if (!resolvedPath.startsWith(resolvedRoot)) {
    throw new Error('Invalid directory path - directory traversal not allowed');
  }
  
  return resolvedPath;
}

// Helper function to search files
async function searchFiles(regex, directory, recursive) {
  const results = [];
  
  async function searchDirectory(dir, basePath) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      // Skip directories that can't be read (unless it's the root)
      if (dir === directory) {
        throw error;
      }
      return;
    }
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(basePath, fullPath);
      
      if (entry.isDirectory()) {
        if (recursive) {
          await searchDirectory(fullPath, basePath);
        }
      } else if (entry.isFile()) {
        try {
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          if (regex.test(content)) {
            // Normalize path separators to forward slashes
            results.push(relativePath.replace(/\\/g, '/'));
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }
    }
  }
  
  await searchDirectory(directory, directory);
  return results;
}

app.get('/search', async (req, res) => {
  try {
    const { regex: regexPattern, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regexPattern) {
      return res.status(400).json({ error: 'Missing required parameter: regex' });
    }
    
    // Create regex object
    let regex;
    try {
      regex = new RegExp(regexPattern);
    } catch (error) {
      return res.status(400).json({ error: `Invalid regex pattern: ${error.message}` });
    }
    
    // Validate and normalize directory
    let searchDir;
    try {
      searchDir = validateAndNormalizePath(directory);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    
    // Check if directory exists
    try {
      const stats = await fs.promises.stat(searchDir);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Directory does not exist or is not accessible' });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Search files
    const files = await searchFiles(regex, searchDir, isRecursive);
    
    res.json({ files });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});