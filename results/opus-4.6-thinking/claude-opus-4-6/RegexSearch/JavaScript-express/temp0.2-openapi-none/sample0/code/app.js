const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

const FILES_ROOT = path.resolve(__dirname, 'files');

// Ensure the files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

app.get('/search', (req, res) => {
  const { regex, directory, recursive } = req.query;

  // Validate regex parameter
  if (!regex) {
    return res.status(400).json({ error: 'Missing required query parameter: regex' });
  }

  let regexObj;
  try {
    regexObj = new RegExp(regex);
  } catch (e) {
    return res.status(400).json({ error: `Invalid regex pattern: ${e.message}` });
  }

  // Resolve the search directory
  const searchDir = directory
    ? path.resolve(FILES_ROOT, directory)
    : FILES_ROOT;

  // Security check: ensure searchDir is within FILES_ROOT
  if (!searchDir.startsWith(FILES_ROOT)) {
    return res.status(400).json({ error: 'Directory path is outside the allowed files root.' });
  }

  // Check if directory exists and is accessible
  try {
    const stat = fs.statSync(searchDir);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Specified path is not a directory.' });
    }
  } catch (e) {
    return res.status(400).json({ error: `Inaccessible directory: ${e.message}` });
  }

  const isRecursive = recursive === 'true' || recursive === '1';

  const matchingFiles = [];

  function searchDirectory(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (regexObj.test(content)) {
            const relativePath = path.relative(searchDir, fullPath);
            matchingFiles.push(relativePath.split(path.sep).join('/'));
          }
        } catch (e) {
          // Skip files that can't be read
        }
      } else if (entry.isDirectory() && isRecursive) {
        searchDirectory(fullPath);
      }
    }
  }

  try {
    searchDirectory(searchDir);
    return res.status(200).json({ files: matchingFiles });
  } catch (e) {
    return res.status(500).json({ error: `Internal server error: ${e.message}` });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('File Search API running on http://0.0.0.0:5000');
});