const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

const FILES_ROOT = path.resolve(__dirname, 'files');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Ensure files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

function getFiles(dirPath, recursive, baseDir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    // Ensure we don't follow symlinks outside the root
    const realPath = fs.realpathSync(fullPath);
    if (!realPath.startsWith(FILES_ROOT)) {
      continue;
    }

    if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath);
      results.push({ fullPath, relativePath });
    } else if (entry.isDirectory() && recursive) {
      results = results.concat(getFiles(fullPath, recursive, baseDir));
    }
  }

  return results;
}

app.get('/search', (req, res) => {
  try {
    const { regex, directory, recursive } = req.query;

    // Validate regex parameter
    if (!regex || typeof regex !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid regex parameter.' });
    }

    // Limit regex length to prevent ReDoS
    if (regex.length > 1000) {
      return res.status(400).json({ error: 'Regex pattern is too long.' });
    }

    // Try to compile the regex
    let pattern;
    try {
      pattern = new RegExp(regex);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid regex pattern.' });
    }

    // Determine search directory
    let searchDir = FILES_ROOT;
    if (directory && typeof directory === 'string') {
      // Resolve the directory relative to FILES_ROOT and validate
      searchDir = path.resolve(FILES_ROOT, directory);
      const realSearchDir = fs.existsSync(searchDir) ? fs.realpathSync(searchDir) : null;

      if (!realSearchDir || !realSearchDir.startsWith(FILES_ROOT)) {
        return res.status(400).json({ error: 'Invalid or inaccessible directory.' });
      }
      searchDir = realSearchDir;
    }

    // Check if directory exists and is accessible
    try {
      const stat = fs.statSync(searchDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory.' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Directory not found or inaccessible.' });
    }

    // Parse recursive flag
    const isRecursive = recursive === 'true' || recursive === '1';

    // Get files
    const files = getFiles(searchDir, isRecursive, searchDir);

    // Search files
    const matchingFiles = [];
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit per file

    for (const file of files) {
      try {
        const stat = fs.statSync(file.fullPath);
        if (stat.size > MAX_FILE_SIZE) {
          continue; // Skip files that are too large
        }
        const content = fs.readFileSync(file.fullPath, 'utf-8');
        if (pattern.test(content)) {
          // Use forward slashes for consistency
          matchingFiles.push(file.relativePath.split(path.sep).join('/'));
        }
      } catch (e) {
        // Skip files that can't be read
        continue;
      }
    }

    return res.status(200).json({ files: matchingFiles });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Catch-all for unhandled routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});