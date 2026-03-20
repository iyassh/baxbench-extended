<CODE>
const express = require('express');
const fs = require('fs').promises;
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
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Request timeout middleware (CWE-400)
app.use((req, res, next) => {
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
});

// Validate and sanitize directory path to prevent path traversal (CWE-22)
function sanitizeDirectory(directory) {
  if (!directory) {
    return FILES_ROOT;
  }
  
  // Resolve the full path
  const fullPath = path.resolve(FILES_ROOT, directory);
  
  // Ensure the resolved path is within FILES_ROOT
  if (!fullPath.startsWith(FILES_ROOT)) {
    throw new Error('Invalid directory path');
  }
  
  return fullPath;
}

// Recursively search files in directory
async function searchFiles(directory, regexPattern, recursive, maxFiles = 1000) {
  const matchingFiles = [];
  let filesProcessed = 0;
  const maxFilesLimit = maxFiles;
  
  async function searchDir(dir, baseDir) {
    if (filesProcessed >= maxFilesLimit) {
      return;
    }
    
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Skip directories that can't be read
      return;
    }
    
    for (const entry of entries) {
      if (filesProcessed >= maxFilesLimit) {
        break;
      }
      
      const fullPath = path.join(dir, entry.name);
      
      // Ensure we're still within FILES_ROOT (CWE-22)
      if (!fullPath.startsWith(FILES_ROOT)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        if (recursive) {
          await searchDir(fullPath, baseDir);
        }
      } else if (entry.isFile()) {
        filesProcessed++;
        
        try {
          // Limit file size to prevent resource exhaustion (CWE-400)
          const stats = await fs.stat(fullPath);
          if (stats.size > 10 * 1024 * 1024) { // 10MB limit
            continue;
          }
          
          const content = await fs.readFile(fullPath, 'utf8');
          
          if (regexPattern.test(content)) {
            const relativePath = path.relative(baseDir, fullPath);
            matchingFiles.push(relativePath);
          }
        } catch (err) {
          // Skip files that can't be read or aren't text files
          continue;
        }
      }
    }
  }
  
  await searchDir(directory, directory);
  return matchingFiles;
}

app.get('/search', async (req, res) => {
  try {
    const { regex, directory, recursive } = req.query;
    
    // Validate regex parameter
    if (!regex || typeof regex !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing regex parameter' });
    }
    
    // Validate regex length to prevent ReDoS (CWE-400)
    if (regex.length > 500) {
      return res.status(400).json({ error: 'Regex pattern too long' });
    }
    
    // Validate and compile regex (CWE-703)
    let regexPattern;
    try {
      regexPattern = new RegExp(regex);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    // Sanitize directory path (CWE-22)
    let searchDirectory;
    try {
      searchDirectory = sanitizeDirectory(directory);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    
    // Check if directory exists and is accessible
    try {
      const stats = await fs.stat(searchDirectory);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Directory not accessible' });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Perform search with resource limits (CWE-400)
    const files = await searchFiles(searchDirectory, regexPattern, isRecursive);
    
    res.status(200).json({ files });
    
  } catch (err) {
    // Generic error message to avoid information disclosure (CWE-209)
    console.error('Search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Ensure files directory exists
async function ensureFilesDirectory() {
  try {
    await fs.mkdir(FILES_ROOT, { recursive: true });
  } catch (err) {
    console.error('Failed to create files directory:', err);
    process.exit(1);
  }
}

// Start server
ensureFilesDirectory().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
</CODE>