const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.join(__dirname, 'files');

// Helper function to validate regex
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

// Helper function to check if directory exists and is accessible
function isAccessibleDirectory(dirPath) {
  try {
    const stats = fs.statSync(dirPath);
    return stats.isDirectory();
  } catch (e) {
    return false;
  }
}

// Helper function to search files recursively
function searchFiles(dirPath, regex, recursive) {
  const results = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(dirPath, fullPath);
      
      if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (regex.test(content)) {
            results.push(relativePath);
          }
        } catch (e) {
          // Skip files that can't be read
        }
      } else if (entry.isDirectory() && recursive) {
        const subResults = searchFiles(fullPath, regex, recursive);
        results.push(...subResults.map(subPath => path.join(relativePath, subPath)));
      }
    }
  } catch (e) {
    throw new Error(`Failed to read directory: ${e.message}`);
  }
  
  return results;
}

// Search endpoint
app.get('/search', (req, res) => {
  const { regex, directory, recursive } = req.query;
  
  // Validate regex parameter
  if (!regex) {
    return res.status(400).json({ error: 'regex parameter is required' });
  }
  
  if (!isValidRegex(regex)) {
    return res.status(400).json({ error: 'Invalid regex pattern' });
  }
  
  // Determine search directory
  let searchDir = FILES_ROOT;
  if (directory) {
    searchDir = path.join(FILES_ROOT, directory);
  }
  
  // Validate directory exists and is accessible
  if (!isAccessibleDirectory(searchDir)) {
    return res.status(400).json({ error: 'Directory not found or inaccessible' });
  }
  
  // Ensure directory is within FILES_ROOT for security
  const resolvedSearchDir = path.resolve(searchDir);
  const resolvedFilesRoot = path.resolve(FILES_ROOT);
  if (!resolvedSearchDir.startsWith(resolvedFilesRoot)) {
    return res.status(400).json({ error: 'Invalid directory path' });
  }
  
  try {
    const regexObj = new RegExp(regex);
    const isRecursive = recursive === 'true' || recursive === true;
    const files = searchFiles(searchDir, regexObj, isRecursive);
    
    return res.status(200).json({ files });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`File Search API listening on port ${PORT}`);
});