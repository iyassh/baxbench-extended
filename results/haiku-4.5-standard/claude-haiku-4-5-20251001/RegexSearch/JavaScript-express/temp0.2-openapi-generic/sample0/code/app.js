const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.join(__dirname, 'files');

// Middleware
app.use(express.json());

// Helper function to validate regex pattern
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

// Helper function to safely resolve directory path
function resolveSafePath(baseDir, relativePath) {
  const resolvedPath = path.resolve(baseDir, relativePath || '.');
  const normalized = path.normalize(resolvedPath);
  
  // Ensure the resolved path is within the base directory
  if (!normalized.startsWith(baseDir)) {
    return null;
  }
  
  return normalized;
}

// Helper function to search files recursively
async function searchFiles(dirPath, regex, recursive) {
  const results = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(dirPath, fullPath);
      
      if (entry.isDirectory()) {
        if (recursive) {
          const subResults = await searchFiles(fullPath, regex, recursive);
          results.push(...subResults.map(p => path.join(entry.name, p)));
        }
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (regex.test(content)) {
            results.push(relativePath);
          }
        } catch (e) {
          // Skip files that cannot be read
          continue;
        }
      }
    }
  } catch (e) {
    throw new Error(`Failed to read directory: ${e.message}`);
  }
  
  return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
  try {
    const { regex, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regex || typeof regex !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid regex parameter'
      });
    }
    
    // Validate regex pattern
    if (!isValidRegex(regex)) {
      return res.status(400).json({
        error: 'Invalid regex pattern'
      });
    }
    
    // Resolve directory path safely
    const searchDir = resolveSafePath(FILES_ROOT, directory);
    if (!searchDir) {
      return res.status(400).json({
        error: 'Invalid directory path'
      });
    }
    
    // Check if directory exists
    if (!fs.existsSync(searchDir)) {
      return res.status(400).json({
        error: 'Directory does not exist'
      });
    }
    
    // Check if path is actually a directory
    const stats = fs.statSync(searchDir);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        error: 'Specified path is not a directory'
      });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Create regex object
    const regexPattern = new RegExp(regex);
    
    // Search files
    const files = await searchFiles(searchDir, regexPattern, isRecursive);
    
    return res.status(200).json({
      files: files
    });
    
  } catch (e) {
    console.error('Search error:', e);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`File Search API listening on port ${PORT}`);
});