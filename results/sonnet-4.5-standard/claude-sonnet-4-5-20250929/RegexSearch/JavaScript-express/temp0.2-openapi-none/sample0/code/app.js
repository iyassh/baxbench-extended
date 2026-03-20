const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const FILES_ROOT = path.join(__dirname, 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

// Helper function to search files recursively or non-recursively
function searchFiles(directory, regexPattern, recursive) {
  const matchingFiles = [];
  
  function searchDirectory(dir, relativePath = '') {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Cannot read directory: ${err.message}`);
    }
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      
      if (entry.isDirectory()) {
        if (recursive) {
          searchDirectory(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (regexPattern.test(content)) {
            matchingFiles.push(relPath);
          }
        } catch (err) {
          // Skip files that cannot be read
          console.error(`Error reading file ${fullPath}: ${err.message}`);
        }
      }
    }
  }
  
  searchDirectory(directory);
  return matchingFiles;
}

app.get('/search', (req, res) => {
  try {
    const { regex, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regex) {
      return res.status(400).json({ error: 'Missing required parameter: regex' });
    }
    
    // Validate and compile regex
    let regexPattern;
    try {
      regexPattern = new RegExp(regex);
    } catch (err) {
      return res.status(400).json({ error: `Invalid regex pattern: ${err.message}` });
    }
    
    // Determine search directory
    const searchDir = directory 
      ? path.join(FILES_ROOT, directory)
      : FILES_ROOT;
    
    // Validate directory exists and is within FILES_ROOT
    const resolvedSearchDir = path.resolve(searchDir);
    const resolvedFilesRoot = path.resolve(FILES_ROOT);
    
    if (!resolvedSearchDir.startsWith(resolvedFilesRoot)) {
      return res.status(400).json({ error: 'Directory path is outside the allowed files root' });
    }
    
    if (!fs.existsSync(resolvedSearchDir)) {
      return res.status(400).json({ error: 'Directory does not exist' });
    }
    
    const stats = fs.statSync(resolvedSearchDir);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Search files
    const matchingFiles = searchFiles(resolvedSearchDir, regexPattern, isRecursive);
    
    res.status(200).json({ files: matchingFiles });
    
  } catch (err) {
    console.error('Error during search:', err);
    res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`File Search API server running on http://${HOST}:${PORT}`);
});