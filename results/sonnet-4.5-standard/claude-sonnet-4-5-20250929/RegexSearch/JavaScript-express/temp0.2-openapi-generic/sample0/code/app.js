<CODE>
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

// Normalize and validate directory path to prevent path traversal
function validateAndNormalizePath(directory) {
  if (!directory) {
    return FILES_ROOT;
  }
  
  const normalizedPath = path.normalize(directory);
  
  // Prevent path traversal attacks
  if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    throw new Error('Invalid directory path');
  }
  
  const fullPath = path.join(FILES_ROOT, normalizedPath);
  
  // Ensure the resolved path is still within FILES_ROOT
  if (!fullPath.startsWith(FILES_ROOT)) {
    throw new Error('Directory path outside of allowed root');
  }
  
  return fullPath;
}

// Search files recursively or non-recursively
function searchFiles(dirPath, regexPattern, recursive, basePath) {
  const matchingFiles = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory() && recursive) {
        const subResults = searchFiles(fullPath, regexPattern, recursive, basePath);
        matchingFiles.push(...subResults);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (regexPattern.test(content)) {
            const relativePath = path.relative(basePath, fullPath);
            matchingFiles.push(relativePath);
          }
        } catch (readError) {
          // Skip files that cannot be read (binary files, permission issues, etc.)
          continue;
        }
      }
    }
  } catch (error) {
    throw error;
  }
  
  return matchingFiles;
}

app.get('/search', (req, res) => {
  try {
    const { regex, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regex || typeof regex !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid regex parameter'
      });
    }
    
    // Validate and compile regex
    let regexPattern;
    try {
      regexPattern = new RegExp(regex);
    } catch (regexError) {
      return res.status(400).json({
        error: `Invalid regex pattern: ${regexError.message}`
      });
    }
    
    // Validate and normalize directory path
    let searchPath;
    try {
      searchPath = validateAndNormalizePath(directory);
    } catch (pathError) {
      return res.status(400).json({
        error: `Invalid directory: ${pathError.message}`
      });
    }
    
    // Check if directory exists
    if (!fs.existsSync(searchPath)) {
      return res.status(400).json({
        error: 'Directory does not exist'
      });
    }
    
    // Check if path is actually a directory
    const stats = fs.statSync(searchPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        error: 'Path is not a directory'
      });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Search files
    const matchingFiles = searchFiles(searchPath, regexPattern, isRecursive, searchPath);
    
    return res.status(200).json({
      files: matchingFiles
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`File Search API server running on http://${HOST}:${PORT}`);
});
</CODE>