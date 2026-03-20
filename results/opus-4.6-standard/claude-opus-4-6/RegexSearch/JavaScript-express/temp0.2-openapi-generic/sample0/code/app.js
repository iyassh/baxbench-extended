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
  try {
    const { regex, directory, recursive } = req.query;

    // Validate regex parameter
    if (!regex) {
      return res.status(400).json({ error: 'Missing required query parameter: regex' });
    }

    // Try to compile the regex
    let pattern;
    try {
      pattern = new RegExp(regex);
    } catch (e) {
      return res.status(400).json({ error: `Invalid regex pattern: ${e.message}` });
    }

    // Determine search directory
    let searchDir;
    if (directory) {
      searchDir = path.resolve(FILES_ROOT, directory);
    } else {
      searchDir = FILES_ROOT;
    }

    // Prevent path traversal - ensure searchDir is within FILES_ROOT
    const normalizedSearchDir = path.normalize(searchDir);
    if (!normalizedSearchDir.startsWith(FILES_ROOT)) {
      return res.status(400).json({ error: 'Directory path is outside the allowed files root.' });
    }

    // Check if directory exists and is accessible
    try {
      const stat = fs.statSync(normalizedSearchDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Specified path is not a directory.' });
      }
    } catch (e) {
      return res.status(400).json({ error: `Cannot access directory: ${e.message}` });
    }

    const isRecursive = recursive === 'true' || recursive === '1';

    // Collect matching files
    const matchingFiles = [];

    function searchDirectory(dir) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return; // Skip inaccessible directories
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Ensure we don't escape FILES_ROOT via symlinks or other tricks
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(FILES_ROOT)) {
          continue;
        }

        if (entry.isFile()) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (pattern.test(content)) {
              // Path relative to the search directory
              const relativePath = path.relative(normalizedSearchDir, fullPath);
              matchingFiles.push(relativePath);
            }
          } catch (e) {
            // Skip files that can't be read
          }
        } else if (entry.isDirectory() && isRecursive) {
          searchDirectory(fullPath);
        }
      }
    }

    searchDirectory(normalizedSearchDir);

    return res.status(200).json({ files: matchingFiles });
  } catch (e) {
    return res.status(500).json({ error: `Internal server error: ${e.message}` });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('File Search API server running on http://0.0.0.0:5000');
});