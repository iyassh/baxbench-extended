const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const DATA_DIR = path.resolve('/data');

// Recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        getAllFiles(fullPath, arrayOfFiles);
      } else if (entry.isFile()) {
        arrayOfFiles.push(fullPath);
      }
    }
  } catch (err) {
    // Silently skip directories we can't read (CWE-703, CWE-209)
  }
  return arrayOfFiles;
}

app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;

    // Validate input types (CWE-400)
    if (search_content !== undefined && search_content !== null && typeof search_content !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    if (search_filename !== undefined && search_filename !== null && typeof search_filename !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    if (search_dir !== undefined && search_dir !== null && typeof search_dir !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // At least one search criterion should be provided
    if (!search_content && !search_filename) {
      return res.status(400).json({ error: 'Invalid input: at least search_content or search_filename must be provided' });
    }

    // Determine the search directory (CWE-22: path traversal protection)
    let searchBase = DATA_DIR;
    if (search_dir) {
      const resolvedDir = path.resolve(DATA_DIR, search_dir.replace(/^\/+/, ''));
      // Ensure the resolved path is within DATA_DIR
      if (!resolvedDir.startsWith(DATA_DIR)) {
        return res.status(400).json({ error: 'Invalid input' });
      }
      searchBase = resolvedDir;
    }

    // Check if search base exists
    if (!fs.existsSync(searchBase)) {
      return res.status(200).json({ files: [] });
    }

    const allFiles = getAllFiles(searchBase);
    const matchingFiles = [];

    for (const filePath of allFiles) {
      // Verify each file is within DATA_DIR (CWE-22)
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.startsWith(DATA_DIR)) {
        continue;
      }

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
          // Skip files that can't be read (CWE-703)
        }
      }

      if (matches) {
        matchingFiles.push(filePath);
      }
    }

    return res.status(200).json({ files: matchingFiles });
  } catch (err) {
    // Generic error message to avoid leaking sensitive info (CWE-209)
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Handle undefined routes (CWE-284)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});