const express = require('express');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const FILES_ROOT = path.join(__dirname, 'files');

// Promisify fs functions
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);

// Ensure files root directory exists
if (!fs.existsSync(FILES_ROOT)) {
  console.warn(`Files root directory ${FILES_ROOT} does not exist. Creating it.`);
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

// Helper function to validate regex
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

// Helper function to sanitize directory path
function sanitizeDirectory(dir) {
  if (!dir) return '';
  // Normalize and remove path traversal attempts
  const normalized = path.normalize(dir).replace(/^(\.\.[\/\\])+/, '');
  return normalized.replace(/^[\/\\]+/, '');
}

// Helper function to search files recursively
async function searchFiles(directory, regex, recursive = false, relativePath = '') {
  const results = [];
  
  try {
    const files = await readdir(directory);
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const fileRelativePath = relativePath ? path.join(relativePath, file) : file;
      
      try {
        const stats = await stat(filePath);
        
        if (stats.isDirectory() && recursive) {
          const subResults = await searchFiles(filePath, regex, recursive, fileRelativePath);
          results.push(...subResults);
        } else if (stats.isFile()) {
          try {
            const content = await readFile(filePath, 'utf8');
            if (regex.test(content)) {
              results.push(fileRelativePath.replace(/\\/g, '/'));
            }
          } catch (err) {
            // Skip files that can't be read as text (binary files, etc.)
            continue;
          }
        }
      } catch (err) {
        // Skip files we can't access
        continue;
      }
    }
  } catch (err) {
    throw err;
  }
  
  return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
  try {
    const { regex: regexPattern, directory, recursive } = req.query;
    
    // Validate required parameters
    if (!regexPattern) {
      return res.status(400).json({
        error: 'regex parameter is required'
      });
    }
    
    // Validate regex
    if (!isValidRegex(regexPattern)) {
      return res.status(400).json({
        error: 'Invalid regex pattern'
      });
    }
    
    // Create regex object
    const regex = new RegExp(regexPattern);
    
    // Sanitize directory path
    const sanitizedDir = sanitizeDirectory(directory);
    const searchDir = path.join(FILES_ROOT, sanitizedDir);
    
    // Security check: ensure search directory is within FILES_ROOT
    if (!path.resolve(searchDir).startsWith(path.resolve(FILES_ROOT))) {
      return res.status(400).json({
        error: 'Invalid directory path'
      });
    }
    
    // Check if search directory exists
    try {
      const dirStats = await stat(searchDir);
      if (!dirStats.isDirectory()) {
        return res.status(400).json({
          error: 'Specified path is not a directory'
        });
      }
    } catch (err) {
      return res.status(400).json({
        error: 'Directory not found or inaccessible'
      });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Search files
    const matchingFiles = await searchFiles(searchDir, regex, isRecursive);
    
    res.json({
      files: matchingFiles
    });
    
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`File Search API server running on http://${HOST}:${PORT}`);
});