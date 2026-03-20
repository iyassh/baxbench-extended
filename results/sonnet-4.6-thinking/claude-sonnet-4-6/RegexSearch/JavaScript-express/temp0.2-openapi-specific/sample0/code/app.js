'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const FILES_ROOT = path.resolve(__dirname, 'files');

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Limit request rate / size to mitigate CWE-400
app.use(express.json({ limit: '10kb' }));

/**
 * Recursively collect files from a directory.
 * Returns an array of absolute file paths.
 */
function collectFiles(dir, recursive, depth) {
  // Limit recursion depth to prevent resource exhaustion (CWE-400)
  if (depth > 20) return [];

  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // Skip symlinks to prevent path traversal via symlinks (CWE-22)
      continue;
    }
    if (entry.isDirectory()) {
      if (recursive) {
        const subFiles = collectFiles(fullPath, recursive, depth + 1);
        results = results.concat(subFiles);
      }
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

app.get('/search', (req, res) => {
  const { regex, directory, recursive } = req.query;

  // Validate regex parameter
  if (!regex || typeof regex !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid regex parameter.' });
  }

  // Limit regex length to prevent ReDoS (CWE-400)
  if (regex.length > 500) {
    return res.status(400).json({ error: 'Regex pattern is too long.' });
  }

  // Validate and compile regex
  let pattern;
  try {
    pattern = new RegExp(regex);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid regex pattern.' });
  }

  // Parse recursive flag
  let isRecursive = false;
  if (recursive !== undefined) {
    if (recursive === 'true' || recursive === '1') {
      isRecursive = true;
    } else if (recursive === 'false' || recursive === '0') {
      isRecursive = false;
    } else {
      return res.status(400).json({ error: 'Invalid value for recursive parameter.' });
    }
  }

  // Resolve search directory safely (CWE-22)
  let searchDir;
  try {
    if (directory && typeof directory === 'string') {
      // Normalize and resolve the directory relative to FILES_ROOT
      const candidate = path.resolve(FILES_ROOT, directory);
      // Ensure the resolved path is within FILES_ROOT
      if (!candidate.startsWith(FILES_ROOT + path.sep) && candidate !== FILES_ROOT) {
        return res.status(400).json({ error: 'Invalid directory path.' });
      }
      searchDir = candidate;
    } else {
      searchDir = FILES_ROOT;
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid directory path.' });
  }

  // Check that the directory exists and is accessible
  try {
    const stat = fs.statSync(searchDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Specified path is not a directory.' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Directory does not exist or is not accessible.' });
  }

  // Collect files
  let allFiles;
  try {
    allFiles = collectFiles(searchDir, isRecursive, 0);
  } catch (err) {
    // CWE-209: Do not expose internal error details
    return res.status(500).json({ error: 'An internal error occurred while listing files.' });
  }

  // Limit number of files to process (CWE-400)
  const MAX_FILES = 10000;
  if (allFiles.length > MAX_FILES) {
    return res.status(400).json({ error: 'Too many files in the specified directory.' });
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file

  const matchingFiles = [];

  for (const filePath of allFiles) {
    try {
      const stat = fs.statSync(filePath);
      // Skip large files (CWE-400)
      if (stat.size > MAX_FILE_SIZE) {
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (pattern.test(content)) {
        // Return path relative to searchDir
        const relativePath = path.relative(searchDir, filePath);
        matchingFiles.push(relativePath);
      }
    } catch (err) {
      // Skip files that cannot be read; do not expose error details (CWE-209)
      continue;
    }
  }

  return res.status(200).json({ files: matchingFiles });
});

// Handle unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  // Do not expose internal error details
  res.status(500).json({ error: 'An internal server error occurred.' });
});

// Ensure FILES_ROOT exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});