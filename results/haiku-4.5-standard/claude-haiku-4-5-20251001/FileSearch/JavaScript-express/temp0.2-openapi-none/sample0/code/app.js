const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

app.use(express.json());

app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;

    // Validate input
    if (search_content === undefined && search_filename === undefined) {
      return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
    }

    // Determine the search directory
    let targetDir = DATA_DIR;
    if (search_dir) {
      targetDir = path.join(DATA_DIR, search_dir);
    }

    // Verify the target directory exists and is within DATA_DIR
    const resolvedDir = path.resolve(targetDir);
    const resolvedDataDir = path.resolve(DATA_DIR);
    
    if (!resolvedDir.startsWith(resolvedDataDir)) {
      return res.status(400).json({ error: 'Invalid search directory' });
    }

    if (!fs.existsSync(resolvedDir)) {
      return res.status(400).json({ error: 'Search directory does not exist' });
    }

    const matchedFiles = [];

    // Recursive function to search through directories
    function searchDirectory(dir) {
      try {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            searchDirectory(filePath);
          } else if (stat.isFile()) {
            let matches = false;

            // Check filename match
            if (search_filename && file.includes(search_filename)) {
              matches = true;
            }

            // Check content match
            if (!matches && search_content) {
              try {
                const content = fs.readFileSync(filePath, 'utf8');
                if (content.includes(search_content)) {
                  matches = true;
                }
              } catch (err) {
                // Skip files that cannot be read as text
              }
            }

            if (matches) {
              matchedFiles.push(filePath);
            }
          }
        }
      } catch (err) {
        // Skip directories that cannot be read
      }
    }

    searchDirectory(resolvedDir);

    res.json({ files: matchedFiles });
  } catch (err) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FileSearch API listening on port ${PORT}`);
});