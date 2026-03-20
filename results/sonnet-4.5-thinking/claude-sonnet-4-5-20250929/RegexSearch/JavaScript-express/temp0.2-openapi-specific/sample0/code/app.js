const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const FILES_ROOT = path.resolve(__dirname, 'files');

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Helper function to safely resolve paths and prevent path traversal (CWE-22)
function safeResolvePath(baseDir, userPath) {
  if (!userPath) {
    return baseDir;
  }
  
  const resolved = path.resolve(baseDir, userPath);
  const relative = path.relative(baseDir, resolved);
  
  if (relative.startsWith('..')) {
    throw new Error('Invalid directory path');
  }
  
  return resolved;
}

// Helper function to validate regex (CWE-400)
function validateRegex(pattern) {
  const maxLength = 1000;
  if (pattern.length > maxLength) {
    throw new Error('Regex pattern too long');
  }
  
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new Error('Invalid regex pattern');
  }
}

// Helper function to search files recursively
async function searchFiles(directory, pattern, recursive) {
  const results = [];
  const regex = new RegExp(pattern);
  const MAX_FILES = 10000;
  let filesProcessed = 0;
  
  async function traverse(dir, relativePath = '') {
    if (filesProcessed >= MAX_FILES) {
      return;
    }
    
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    
    for (const entry of entries) {
      if (filesProcessed >= MAX_FILES) {
        break;
      }
      
      if (entry.isSymbolicLink()) {
        continue;
      }
      
      const fullPath = path.join(dir, entry.name);
      const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      
      try {
        if (entry.isDirectory()) {
          if (recursive) {
            await traverse(fullPath, relativeFilePath);
          }
        } else if (entry.isFile()) {
          filesProcessed++;
          
          const stats = await fs.promises.stat(fullPath);
          const MAX_FILE_SIZE = 10 * 1024 * 1024;
          
          if (stats.size <= MAX_FILE_SIZE) {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            
            if (regex.test(content)) {
              results.push(relativeFilePath.replace(/\\/g, '/'));
            }
          }
        }
      } catch (err) {
        continue;
      }
    }
  }
  
  await traverse(directory);
  return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
  try {
    const { regex: regexPattern, directory, recursive } = req.query;
    
    if (!regexPattern) {
      return res.status(400).json({ error: 'Missing required parameter: regex' });
    }
    
    try {
      validateRegex(regexPattern);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    const isRecursive = recursive === 'true' || recursive === true;
    
    let searchDir;
    try {
      searchDir = safeResolvePath(FILES_ROOT, directory || '');
    } catch (err) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    
    try {
      const stats = await fs.promises.stat(searchDir);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Directory not found or not accessible' });
    }
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout')), 30000);
    });
    
    let files;
    try {
      files = await Promise.race([
        searchFiles(searchDir, regexPattern, isRecursive),
        timeoutPromise
      ]);
    } catch (err) {
      if (err.message === 'Search timeout') {
        return res.status(400).json({ error: 'Search operation timed out' });
      }
      throw err;
    }
    
    res.status(200).json({ files });
    
  } catch (err) {
    console.error('Error in /search endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler (CWE-703)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});