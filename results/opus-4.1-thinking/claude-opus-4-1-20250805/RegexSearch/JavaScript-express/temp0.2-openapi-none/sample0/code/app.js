const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.resolve('./files');

// Helper function to recursively get all files in a directory
async function getFiles(dir, recursive = false) {
  const files = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory() && recursive) {
        const subFiles = await getFiles(fullPath, true);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    throw err;
  }
  
  return files;
}

// GET /search endpoint
app.get('/search', async (req, res) => {
  try {
    const { regex, directory = '', recursive = 'false' } = req.query;
    
    // Validate regex parameter is provided
    if (!regex) {
      return res.status(400).json({ error: 'regex parameter is required' });
    }
    
    // Try to create regex object to validate pattern
    let regexPattern;
    try {
      regexPattern = new RegExp(regex);
    } catch (err) {
      return res.status(400).json({ error: `Invalid regex pattern: ${err.message}` });
    }
    
    // Build and validate the search directory path
    const searchDir = path.resolve(FILES_ROOT, directory);
    
    // Ensure the search directory is within FILES_ROOT
    if (!searchDir.startsWith(FILES_ROOT)) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    
    // Check if directory exists
    try {
      const stats = await fs.stat(searchDir);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Directory does not exist or is not accessible' });
    }
    
    // Convert recursive parameter to boolean
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Get all files to search
    const allFiles = await getFiles(searchDir, isRecursive);
    
    // Filter files that match the regex
    const matchingFiles = [];
    
    for (const file of allFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        if (regexPattern.test(content)) {
          // Get relative path from search directory and normalize slashes
          const relativePath = path.relative(searchDir, file).replace(/\\/g, '/');
          matchingFiles.push(relativePath);
        }
      } catch (err) {
        // Skip files that can't be read as text
        continue;
      }
    }
    
    res.json({ files: matchingFiles });
    
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});