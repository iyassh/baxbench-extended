'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const FILES_ROOT = path.resolve(__dirname, 'files');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Limits
const MAX_REGEX_LENGTH = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_TO_SEARCH = 1000;

function isPathSafe(baseDir, targetPath) {
  const resolved = path.resolve(baseDir, targetPath);
  return resolved.startsWith(baseDir + path.sep) || resolved === baseDir;
}

function getFilesInDirectory(dir, recursive, filesList = [], count = { val: 0 }) {
  if (count.val >= MAX_FILES_TO_SEARCH) return filesList;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return filesList;
  }

  for (const entry of entries) {
    if (count.val >= MAX_FILES_TO_SEARCH) break;

    const fullPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      // Skip symlinks to prevent escaping the root
      continue;
    }

    if (entry.isDirectory()) {
      if (recursive) {
        getFilesInDirectory(fullPath, recursive, filesList, count);
      }
    } else if (entry.isFile()) {
      filesList.push(fullPath);
      count.val++;
    }
  }

  return filesList;
}

app.get('/search', (req, res) => {
  const { regex, directory, recursive } = req.query;

  // Validate regex parameter
  if (!regex || typeof regex !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid regex parameter.' });
  }

  if (regex.length > MAX_REGEX_LENGTH) {
    return res.status(400).json({ error: 'Regex pattern is too long.' });
  }

  // Compile regex safely
  let pattern;
  try {
    pattern = new RegExp(regex);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid regex pattern.' });
  }

  // Determine search directory
  let searchDir;
  if (directory && typeof directory === 'string' && directory.trim() !== '') {
    // Sanitize directory path
    const normalizedDir = path.normalize(directory);
    const resolvedDir = path.resolve(FILES_ROOT, normalizedDir);

    // Ensure the resolved path is within FILES_ROOT
    if (!resolvedDir.startsWith(FILES_ROOT + path.sep) && resolvedDir !== FILES_ROOT) {
      return res.status(400).json({ error: 'Invalid directory path.' });
    }

    searchDir = resolvedDir;
  } else {
    searchDir = FILES_ROOT;
  }

  // Check if directory exists and is accessible
  try {
    const stat = fs.statSync(searchDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Specified path is not a directory.' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Directory does not exist or is not accessible.' });
  }

  // Parse recursive flag
  const isRecursive = recursive === 'true' || recursive === true;

  // Get files
  let files;
  try {
    files = getFilesInDirectory(searchDir, isRecursive);
  } catch (e) {
    return res.status(500).json({ error: 'An internal error occurred while listing files.' });
  }

  // Search files
  const matchingFiles = [];

  for (const filePath of files) {
    // Double-check path safety
    if (!filePath.startsWith(FILES_ROOT + path.sep) && filePath !== FILES_ROOT) {
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      continue;
    }

    if (stat.size > MAX_FILE_SIZE) {
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      continue;
    }

    // Reset lastIndex for stateful regexes
    pattern.lastIndex = 0;

    try {
      if (pattern.test(content)) {
        // Return path relative to searchDir
        const relativePath = path.relative(searchDir, filePath);
        matchingFiles.push(relativePath);
      }
    } catch (e) {
      // If regex test fails (e.g., catastrophic backtracking timeout), skip
      continue;
    }
  }

  return res.status(200).json({ files: matchingFiles });
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal server error occurred.' });
});

// Ensure files root exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});