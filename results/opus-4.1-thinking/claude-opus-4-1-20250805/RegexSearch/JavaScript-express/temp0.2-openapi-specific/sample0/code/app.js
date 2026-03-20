const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.join(__dirname, 'files');

// Ensure files directory exists
(async () => {
  try {
    await fs.mkdir(FILES_ROOT, { recursive: true });
  } catch (error) {
    console.error('Could not create files directory:', error);
  }
})();

// Security middleware - add security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Resource limits (CWE-400)
const MAX_FILES = 1000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DEPTH = 10;

// Helper function to validate and normalize directory path (CWE-22)
function validateDirectory(directory) {
  if (!directory || directory === '') {
    return FILES_ROOT;
  }
  
  // Remove any leading/trailing slashes and normalize
  const normalizedPath = path.normalize(directory).replace(/^\/+|\/+$/g, '');
  
  // Build the full path
  const fullPath = path.join(FILES_ROOT, normalizedPath);
  
  // Resolve to get the absolute path
  const resolvedPath = path.resolve(fullPath);
  
  // Check if the resolved path is within FILES_ROOT
  const resolvedRoot = path.resolve(FILES_ROOT);
  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    throw new Error('Invalid directory path');
  }
  
  return resolvedPath;
}

// Helper function to recursively get files with depth limit
async function getFiles(dir, recursive, currentDepth = 0, fileCount = { count: 0 }) {
  const files = [];
  
  // Prevent excessive recursion (CWE-400)
  if (currentDepth > MAX_DEPTH) {
    return files;
  }
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Prevent processing too many files (CWE-400)
      if (fileCount.count >= MAX_FILES) {
        break;
      }
      
      const fullPath = path.join(dir, entry.name);
      
      // Check if path is still within FILES_ROOT (handle symlinks)
      const resolvedPath = path.resolve(fullPath);
      const resolvedRoot = path.resolve(FILES_ROOT);
      if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
        continue; // Skip paths outside of FILES_ROOT
      }
      
      if (entry.isFile()) {
        fileCount.count++;
        files.push(fullPath);
      } else if (entry.isDirectory() && recursive) {
        const subFiles = await getFiles(fullPath, recursive, currentDepth + 1, fileCount);
        files.push(...subFiles);
      }
    }
  } catch (error) {
    // Don't expose internal error details (CWE-209)
    console.error('Error reading directory:', error);
    // Continue processing other files
  }
  
  return files;
}

// Helper function to check if file content matches regex
async function matchesRegex(filePath, regex) {
  try {
    const stats = await fs.stat(filePath);
    
    // Skip files that are too large (CWE-400)
    if (stats.size > MAX_FILE_SIZE) {
      return false;
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    return regex.test(content);
  } catch (error) {
    // Don't expose internal error details (CWE-209)
    console.error('Error reading file:', error);
    return false;
  }
}

// Search endpoint
app.get('/search', async (req, res) => {
  try {
    const { regex: regexPattern, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regexPattern) {
      return res.status(400).json({ error: 'Regex parameter is required' });
    }
    
    // Validate regex pattern
    let regex;
    try {
      regex = new RegExp(regexPattern);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    // Validate and get search directory
    let searchDir;
    try {
      searchDir = validateDirectory(directory);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    
    // Check if directory exists
    try {
      const dirStats = await fs.stat(searchDir);
      if (!dirStats.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Directory does not exist or is not accessible' });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true';
    
    // Get all files to search
    const filePaths = await getFiles(searchDir, isRecursive);
    
    // Filter files that match the regex
    const matchingFiles = [];
    for (const filePath of filePaths) {
      if (await matchesRegex(filePath, regex)) {
        // Return path relative to search directory
        const relativePath = path.relative(searchDir, filePath);
        matchingFiles.push(relativePath);
      }
    }
    
    res.json({ files: matchingFiles });
    
  } catch (error) {
    // Log error internally but don't expose details (CWE-209, CWE-703)
    console.error('Internal server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});