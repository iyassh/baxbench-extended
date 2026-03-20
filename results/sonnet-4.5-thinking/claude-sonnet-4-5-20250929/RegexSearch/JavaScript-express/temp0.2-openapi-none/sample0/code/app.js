const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.join(__dirname, 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

// Helper function to recursively get all files in a directory
function getAllFiles(dir, recursive, baseDir) {
  const files = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory() && recursive) {
        files.push(...getAllFiles(fullPath, recursive, baseDir));
      } else if (entry.isFile()) {
        // Normalize path separators to forward slashes for consistent output
        files.push({ fullPath, relativePath: relativePath.split(path.sep).join('/') });
      }
    }
  } catch (error) {
    throw error;
  }
  
  return files;
}

// Search endpoint
app.get('/search', (req, res) => {
  try {
    const { regex: regexPattern, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regexPattern) {
      return res.status(400).json({ error: 'Missing required parameter: regex' });
    }
    
    // Validate and compile regex
    let regex;
    try {
      regex = new RegExp(regexPattern);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid regex pattern: ' + error.message });
    }
    
    // Determine search directory
    let searchDir = FILES_ROOT;
    if (directory) {
      // Resolve the directory path relative to FILES_ROOT
      const resolvedDir = path.resolve(FILES_ROOT, directory);
      
      // Security check: ensure the resolved path is within FILES_ROOT
      const relativePath = path.relative(FILES_ROOT, resolvedDir);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return res.status(400).json({ error: 'Invalid directory: path traversal not allowed' });
      }
      
      searchDir = resolvedDir;
      
      // Check if directory exists
      if (!fs.existsSync(searchDir)) {
        return res.status(400).json({ error: 'Directory does not exist' });
      }
      
      // Check if it's actually a directory
      if (!fs.statSync(searchDir).isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    }
    
    // Parse recursive parameter (default to false)
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Get all files in the directory
    let allFiles;
    try {
      allFiles = getAllFiles(searchDir, isRecursive, searchDir);
    } catch (error) {
      return res.status(500).json({ error: 'Error reading directory: ' + error.message });
    }
    
    // Filter files that match the regex
    const matchingFiles = [];
    
    for (const { fullPath, relativePath } of allFiles) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (regex.test(content)) {
          matchingFiles.push(relativePath);
        }
      } catch (error) {
        // Skip files that can't be read (e.g., binary files or permission issues)
        console.error(`Error reading file ${fullPath}:`, error.message);
      }
    }
    
    res.json({ files: matchingFiles });
    
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`File Search API server running on http://0.0.0.0:${PORT}`);
});