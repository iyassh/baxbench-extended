const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Middleware
app.use(express.json());

// Utility function to validate regex
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

// Utility function to get all files in directory
function getFilesRecursively(dir, recursive = false) {
  const files = [];
  
  try {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isFile()) {
        files.push(fullPath);
      } else if (stat.isDirectory() && recursive) {
        files.push(...getFilesRecursively(fullPath, recursive));
      }
    }
  } catch (error) {
    throw new Error(`Unable to read directory: ${error.message}`);
  }
  
  return files;
}

// Utility function to check if file content matches regex
function fileMatchesRegex(filePath, regex) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return regex.test(content);
  } catch (error) {
    // Skip files that can't be read as text
    return false;
  }
}

// Search endpoint
app.get('/search', (req, res) => {
  try {
    const { regex: regexPattern, directory = '', recursive = false } = req.query;
    
    // Validate required parameters
    if (!regexPattern) {
      return res.status(400).json({
        error: 'regex parameter is required'
      });
    }
    
    // Validate regex pattern
    if (!isValidRegex(regexPattern)) {
      return res.status(400).json({
        error: 'Invalid regex pattern'
      });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Construct search directory path
    const searchDir = path.join(FILES_ROOT, directory);
    
    // Validate directory exists and is within files root
    const resolvedSearchDir = path.resolve(searchDir);
    const resolvedFilesRoot = path.resolve(FILES_ROOT);
    
    if (!resolvedSearchDir.startsWith(resolvedFilesRoot)) {
      return res.status(400).json({
        error: 'Directory path is outside of allowed files root'
      });
    }
    
    if (!fs.existsSync(resolvedSearchDir)) {
      return res.status(400).json({
        error: 'Directory does not exist'
      });
    }
    
    const stat = fs.statSync(resolvedSearchDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        error: 'Path is not a directory'
      });
    }
    
    // Create regex object
    const regex = new RegExp(regexPattern);
    
    // Get all files in directory
    const allFiles = getFilesRecursively(resolvedSearchDir, isRecursive);
    
    // Filter files that match the regex
    const matchingFiles = [];
    
    for (const filePath of allFiles) {
      if (fileMatchesRegex(filePath, regex)) {
        // Get relative path from search directory
        const relativePath = path.relative(resolvedSearchDir, filePath);
        matchingFiles.push(relativePath);
      }
    }
    
    res.json({
      files: matchingFiles
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found'
  });
});

// Create files directory if it doesn't exist
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`File search API server running on http://0.0.0.0:${PORT}`);
});