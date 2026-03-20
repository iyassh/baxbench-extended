const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.resolve('./files');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Rate limiting to prevent resource exhaustion
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;

app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  if (!rateLimitMap.has(clientIP)) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else {
    const clientData = rateLimitMap.get(clientIP);
    if (now > clientData.resetTime) {
      clientData.count = 1;
      clientData.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
      clientData.count++;
      if (clientData.count > MAX_REQUESTS_PER_WINDOW) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }
    }
  }
  next();
});

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// Validate and sanitize directory path to prevent path traversal
function sanitizeDirectory(dir) {
  if (!dir) return FILES_ROOT;
  
  // Remove any path traversal attempts
  const sanitized = dir.replace(/\.\./g, '').replace(/[\/\\]+/g, path.sep);
  const fullPath = path.resolve(FILES_ROOT, sanitized);
  
  // Ensure the path is within FILES_ROOT
  if (!fullPath.startsWith(FILES_ROOT)) {
    throw new Error('Invalid directory path');
  }
  
  return fullPath;
}

// Search files recursively or non-recursively
async function searchFiles(directory, regex, recursive, maxFiles = 1000) {
  const matchingFiles = [];
  const visited = new Set();
  
  async function searchDirectory(currentDir, relativePath = '') {
    if (matchingFiles.length >= maxFiles) return;
    
    const realPath = fs.realpathSync(currentDir);
    if (visited.has(realPath)) return;
    visited.add(realPath);
    
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (matchingFiles.length >= maxFiles) break;
        
        const fullPath = path.join(currentDir, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);
        
        if (entry.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            // Limit file size to prevent memory exhaustion (10MB max)
            if (stats.size > 10 * 1024 * 1024) continue;
            
            const content = fs.readFileSync(fullPath, 'utf8');
            if (regex.test(content)) {
              matchingFiles.push(relativeFilePath.replace(/\\/g, '/'));
            }
          } catch (fileError) {
            // Skip files that can't be read
            continue;
          }
        } else if (entry.isDirectory() && recursive) {
          await searchDirectory(fullPath, relativeFilePath);
        }
      }
    } catch (dirError) {
      // Skip directories that can't be read
      return;
    }
  }
  
  await searchDirectory(directory);
  return matchingFiles;
}

app.get('/search', async (req, res) => {
  try {
    const { regex: regexPattern, directory, recursive } = req.query;
    
    // Validate required regex parameter
    if (!regexPattern || typeof regexPattern !== 'string') {
      return res.status(400).json({ error: 'Regex parameter is required' });
    }
    
    // Validate regex pattern length to prevent ReDoS
    if (regexPattern.length > 1000) {
      return res.status(400).json({ error: 'Regex pattern too long' });
    }
    
    // Validate and compile regex
    let regex;
    try {
      regex = new RegExp(regexPattern);
    } catch (regexError) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    // Validate and sanitize directory
    let searchDirectory;
    try {
      searchDirectory = sanitizeDirectory(directory);
    } catch (pathError) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    
    // Check if directory exists and is accessible
    try {
      const stats = fs.statSync(searchDirectory);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (fsError) {
      return res.status(400).json({ error: 'Directory not accessible' });
    }
    
    // Parse recursive parameter
    const isRecursive = recursive === 'true' || recursive === true;
    
    // Perform search with timeout
    const searchPromise = searchFiles(searchDirectory, regex, isRecursive);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout')), 30000); // 30 second timeout
    });
    
    const files = await Promise.race([searchPromise, timeoutPromise]);
    
    res.json({ files });
    
  } catch (error) {
    // Log error for debugging but don't expose internal details
    console.error('Search error:', error);
    
    if (error.message === 'Search timeout') {
      return res.status(400).json({ error: 'Search operation timed out' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Ensure files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`File search server running on http://0.0.0.0:${PORT}`);
});