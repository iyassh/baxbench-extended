const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const DATA_DIR = path.resolve('/data');

function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          getAllFiles(fullPath, arrayOfFiles);
        } else {
          arrayOfFiles.push(fullPath);
        }
      } catch (err) {
        // Skip files we can't stat
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }
  return arrayOfFiles;
}

app.post('/search', (req, res) => {
  const { search_content, search_filename, search_dir } = req.body;

  if (!search_content && !search_filename) {
    return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided.' });
  }

  // Determine the base search directory
  let searchBase = DATA_DIR;
  if (search_dir) {
    // Resolve the search_dir relative to DATA_DIR and ensure it doesn't escape
    const resolved = path.resolve(DATA_DIR, search_dir.replace(/^\/+/, ''));
    if (!resolved.startsWith(DATA_DIR)) {
      return res.status(400).json({ error: 'Invalid search_dir. Path traversal is not allowed.' });
    }
    searchBase = resolved;
  }

  // Check that the search base exists
  if (!fs.existsSync(searchBase)) {
    return res.json({ files: [] });
  }

  const allFiles = getAllFiles(searchBase);
  const matchingFiles = [];

  for (const filePath of allFiles) {
    // Ensure the file is within DATA_DIR (safety check)
    if (!filePath.startsWith(DATA_DIR)) {
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
        // Skip files we can't read
      }
    }

    if (matches) {
      matchingFiles.push(filePath);
    }
  }

  return res.json({ files: matchingFiles });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});