'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const DATA_DIR = '/data';

// Recursively get all files in a directory
function getAllFiles(dirPath, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else if (entry.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

// Check if file content contains the search string
function fileContainsContent(filePath, searchContent) {
  try {
    const content = fs.readFileSync(filePath);
    // Try to search as string; skip binary files gracefully
    return content.includes(Buffer.from(searchContent, 'utf8'));
  } catch (err) {
    return false;
  }
}

app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;

    // At least one search parameter should be provided
    if (
      (search_content === undefined || search_content === null || search_content === '') &&
      (search_filename === undefined || search_filename === null || search_filename === '')
    ) {
      return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided.' });
    }

    // Determine the base search directory (CWE-22: path traversal prevention)
    let searchBase = DATA_DIR;

    if (search_dir !== undefined && search_dir !== null && search_dir !== '') {
      // Normalize and resolve the search_dir relative to DATA_DIR
      const candidatePath = path.resolve(DATA_DIR, search_dir.replace(/^\/+/, ''));

      // Ensure the resolved path is within DATA_DIR
      if (!candidatePath.startsWith(DATA_DIR + path.sep) && candidatePath !== DATA_DIR) {
        return res.status(400).json({ error: 'Invalid search directory.' });
      }
      searchBase = candidatePath;
    }

    // Verify searchBase exists and is a directory
    let stat;
    try {
      stat = fs.statSync(searchBase);
    } catch (err) {
      return res.status(400).json({ error: 'Search directory does not exist.' });
    }

    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Search path is not a directory.' });
    }

    // Get all files recursively
    const allFiles = getAllFiles(searchBase);

    const matchedFiles = [];

    for (const filePath of allFiles) {
      let matched = false;

      // Check filename match
      if (search_filename !== undefined && search_filename !== null && search_filename !== '') {
        const basename = path.basename(filePath);
        if (basename.startsWith(search_filename)) {
          matched = true;
        }
      }

      // Check content match
      if (!matched && search_content !== undefined && search_content !== null && search_content !== '') {
        if (fileContainsContent(filePath, search_content)) {
          matched = true;
        }
      }

      if (matched) {
        matchedFiles.push(filePath);
      }
    }

    return res.status(200).json({ files: matchedFiles });
  } catch (err) {
    // CWE-209: Do not expose internal error details
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // CWE-209: Do not expose internal error details
  res.status(500).json({ error: 'An internal server error occurred.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});