const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

const FILES_ROOT = path.resolve(__dirname, 'files');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Limit query string size
app.use((req, res, next) => {
  const queryString = req.originalUrl.split('?')[1] || '';
  if (queryString.length > 2048) {
    return res.status(400).json({ error: 'Query string too long.' });
  }
  next();
});

function getFilesInDirectory(dirPath, recursive) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      results.push(fullPath);
    } else if (entry.isDirectory() && recursive) {
      const subFiles = getFilesInDirectory(fullPath, recursive);
      results.push(...subFiles);
    }
  }
  return results;
}

app.get('/search', (req, res) => {
  try {
    const { regex, directory, recursive } = req.query;

    // Validate regex parameter
    if (!regex || typeof regex !== 'string') {
      return res.status(400).json({ error: 'The "regex" query parameter is required.' });
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
    let searchDir;
    if (directory && typeof directory === 'string') {
      // Resolve and validate against path traversal
      searchDir = path.resolve(FILES_ROOT, directory);
    } else {
      searchDir = FILES_ROOT;
    }

    // Ensure the resolved path is within FILES_ROOT (CWE-22 protection)
    const normalizedSearchDir = path.normalize(searchDir);
    const normalizedRoot = path.normalize(FILES_ROOT);
    if (!normalizedSearchDir.startsWith(normalizedRoot + path.sep) && normalizedSearchDir !== normalizedRoot) {
      return res.status(400).json({ error: 'Invalid directory path.' });
    }

    // Check if directory exists and is accessible
    try {
      const stat = fs.statSync(searchDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory.' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Directory not found or inaccessible.' });
    }

    // Parse recursive flag
    const isRecursive = recursive === 'true' || recursive === '1';

    // Get files
    const files = getFilesInDirectory(searchDir, isRecursive);

    // Match files against regex
    const matchingFiles = [];
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit per file

    for (const filePath of files) {
      // Ensure each file path is still within FILES_ROOT
      const normalizedFilePath = path.normalize(filePath);
      if (!normalizedFilePath.startsWith(normalizedRoot + path.sep) && normalizedFilePath !== normalizedRoot) {
        continue;
      }

      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_FILE_SIZE) {
          continue; // Skip files that are too large
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        if (pattern.test(content)) {
          // Return path relative to the search directory
          const relativePath = path.relative(searchDir, filePath);
          // Use forward slashes for consistency
          matchingFiles.push(relativePath.split(path.sep).join('/'));
        }
      } catch (err) {
        // Skip files that can't be read
        continue;
      }
    }

    return res.status(200).json({ files: matchingFiles });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Ensure the files directory exists
try {
  if (!fs.existsSync(FILES_ROOT)) {
    fs.mkdirSync(FILES_ROOT, { recursive: true });
  }
} catch (err) {
  // Ignore
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});