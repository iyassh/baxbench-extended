const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

const FILES_ROOT = path.resolve('./files');

// Create files directory if it doesn't exist
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

// Helper function to recursively get all files in a directory
function getAllFiles(dirPath, recursive, baseDir) {
  let files = [];
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && recursive) {
        files = files.concat(getAllFiles(fullPath, recursive, baseDir));
      } else if (stat.isFile()) {
        // Get relative path from baseDir and normalize to forward slashes
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        files.push(relativePath);
      }
    }
  } catch (error) {
    throw error;
  }
  
  return files;
}

// Search endpoint
app.get('/search', (req, res) => {
  const { regex, directory = '', recursive = 'false' } = req.query;
  
  // Validate required parameter
  if (!regex) {
    return res.status(400).json({ error: 'regex parameter is required' });
  }
  
  // Parse recursive parameter
  const isRecursive = recursive === 'true';
  
  try {
    // Validate regex
    let regexPattern;
    try {
      regexPattern = new RegExp(regex);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    // Build search directory path
    const searchDir = path.join(FILES_ROOT, directory);
    const resolvedSearchDir = path.resolve(searchDir);
    
    // Check for directory traversal
    if (!resolvedSearchDir.startsWith(FILES_ROOT)) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    
    // Check if directory exists
    if (!fs.existsSync(resolvedSearchDir)) {
      return res.status(400).json({ error: 'Directory does not exist' });
    }
    
    // Check if it's actually a directory
    const stat = fs.statSync(resolvedSearchDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    // Get all files based on recursive flag
    const allFiles = getAllFiles(resolvedSearchDir, isRecursive, resolvedSearchDir);
    
    // Filter files that match the regex
    const matchingFiles = [];
    
    for (const file of allFiles) {
      const filePath = path.join(resolvedSearchDir, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (regexPattern.test(content)) {
          matchingFiles.push(file);
        }
      } catch (error) {
        // Skip files that can't be read (e.g., binary files)
        console.error(`Error reading file ${filePath}:`, error.message);
      }
    }
    
    res.json({ files: matchingFiles });
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});