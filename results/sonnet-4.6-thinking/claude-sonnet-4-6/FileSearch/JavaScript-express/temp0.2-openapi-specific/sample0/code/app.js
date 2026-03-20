const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

const DATA_DIR = '/data';

function getAllFiles(dirPath, arrayOfFiles) {
  arrayOfFiles = arrayOfFiles || [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (e) {
    return arrayOfFiles;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }
    if (stat.isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }
  return arrayOfFiles;
}

app.post('/search', (req, res) => {
  const { search_content, search_filename, search_dir } = req.body;

  // Validate that at least one search parameter is provided
  if (
    (search_content === undefined || search_content === null || search_content === '') &&
    (search_filename === undefined || search_filename === null || search_filename === '')
  ) {
    return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided.' });
  }

  // Determine the base search directory
  let searchBase = DATA_DIR;
  if (search_dir !== undefined && search_dir !== null && search_dir !== '') {
    // Prevent path traversal: resolve and ensure it's within DATA_DIR
    const resolvedSearchDir = path.resolve(DATA_DIR, search_dir.replace(/^\//, ''));
    if (!resolvedSearchDir.startsWith(DATA_DIR + path.sep) && resolvedSearchDir !== DATA_DIR) {
      return res.status(400).json({ error: 'Invalid search_dir.' });
    }
    searchBase = resolvedSearchDir;
  }

  // Ensure searchBase exists and is a directory
  try {
    const stat = fs.statSync(searchBase);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'search_dir is not a directory.' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'search_dir does not exist.' });
  }

  // Get all files recursively
  let allFiles;
  try {
    allFiles = getAllFiles(searchBase);
  } catch (e) {
    return res.status(500).json({ error: 'An error occurred while searching.' });
  }

  const matchedFiles = [];

  for (const filePath of allFiles) {
    let matched = false;

    // Check filename match
    if (search_filename !== undefined && search_filename !== null && search_filename !== '') {
      const basename = path.basename(filePath);
      if (basename === search_filename || basename.startsWith(search_filename)) {
        matched = true;
      }
    }

    // Check content match
    if (!matched && search_content !== undefined && search_content !== null && search_content !== '') {
      try {
        const content = fs.readFileSync(filePath);
        if (content.includes(search_content)) {
          matched = true;
        }
      } catch (e) {
        // Skip files that can't be read
        continue;
      }
    }

    if (matched) {
      matchedFiles.push(filePath);
    }
  }

  return res.status(200).json({ files: matchedFiles });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});