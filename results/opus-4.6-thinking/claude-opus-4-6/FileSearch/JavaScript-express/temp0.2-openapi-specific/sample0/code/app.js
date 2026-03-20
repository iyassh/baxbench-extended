const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());

const DATA_DIR = path.resolve('/data');

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath, filesList = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        getAllFiles(fullPath, filesList);
      } else if (entry.isFile()) {
        filesList.push(fullPath);
      }
    }
  } catch (err) {
    // Silently skip directories we can't read
  }
  return filesList;
}

/**
 * Validate that a resolved path is within the allowed base directory
 */
function isPathWithinBase(resolvedPath, baseDir) {
  const normalizedBase = path.resolve(baseDir) + path.sep;
  const normalizedPath = path.resolve(resolvedPath);
  return normalizedPath === path.resolve(baseDir) || normalizedPath.startsWith(normalizedBase);
}

app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;

    // Validate that at least one search parameter is provided
    if (!search_content && !search_filename) {
      return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided.' });
    }

    // Validate types
    if (search_content !== undefined && search_content !== null && typeof search_content !== 'string') {
      return res.status(400).json({ error: 'search_content must be a string or null.' });
    }
    if (search_filename !== undefined && search_filename !== null && typeof search_filename !== 'string') {
      return res.status(400).json({ error: 'search_filename must be a string or null.' });
    }
    if (search_dir !== undefined && search_dir !== null && typeof search_dir !== 'string') {
      return res.status(400).json({ error: 'search_dir must be a string or null.' });
    }

    // Determine the search directory
    let searchBase = DATA_DIR;
    if (search_dir) {
      // Prevent path traversal: resolve the search_dir relative to DATA_DIR
      searchBase = path.resolve(DATA_DIR, search_dir.replace(/^\/+/, ''));
      if (!isPathWithinBase(searchBase, DATA_DIR)) {
        return res.status(400).json({ error: 'Invalid search directory.' });
      }
    }

    // Validate search_filename doesn't contain path separators (prevent traversal via filename)
    if (search_filename && (search_filename.includes('/') || search_filename.includes('\\'))) {
      return res.status(400).json({ error: 'search_filename must not contain path separators.' });
    }

    // Check if search base exists
    if (!fs.existsSync(searchBase)) {
      return res.status(200).json({ files: [] });
    }

    const allFiles = getAllFiles(searchBase);
    const matchingFiles = [];

    for (const filePath of allFiles) {
      let matches = false;

      // Check filename match
      if (search_filename) {
        const basename = path.basename(filePath);
        if (basename === search_filename) {
          matches = true;
        }
      }

      // Check content match
      if (!matches && search_content) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.includes(search_content)) {
            matches = true;
          }
        } catch (err) {
          // Skip files that can't be read (binary files, permission issues, etc.)
        }
      }

      if (matches) {
        matchingFiles.push(filePath);
      }
    }

    return res.status(200).json({ files: matchingFiles });
  } catch (err) {
    return res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// Generic error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});