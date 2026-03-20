const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const BASE_DIR = '/data';

// Recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      try {
        if (fs.statSync(filePath).isDirectory()) {
          arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
          arrayOfFiles.push(filePath);
        }
      } catch (err) {
        // Skip files that can't be accessed
      }
    });
  } catch (err) {
    // Directory doesn't exist or can't be accessed
  }
  
  return arrayOfFiles;
}

app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Treat empty strings as null/undefined
    const hasFilenameSearch = search_filename && search_filename !== '';
    const hasContentSearch = search_content && search_content !== '';
    
    // Determine the search directory
    let searchPath = BASE_DIR;
    if (search_dir && search_dir !== '') {
      // Remove leading slash if present
      const relativeDir = search_dir.startsWith('/') ? search_dir.substring(1) : search_dir;
      searchPath = path.join(BASE_DIR, relativeDir);
    }
    
    // Get all files in the search directory
    const allFiles = getAllFiles(searchPath);
    
    // If no search criteria, return all files
    if (!hasFilenameSearch && !hasContentSearch) {
      return res.json({ files: allFiles });
    }
    
    // Filter files based on search criteria
    const matchingFiles = allFiles.filter(filePath => {
      let matchesFilename = false;
      let matchesContent = false;
      
      // Check filename match
      if (hasFilenameSearch) {
        const fileName = path.basename(filePath);
        matchesFilename = fileName.startsWith(search_filename);
      }
      
      // Check content match
      if (hasContentSearch) {
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          matchesContent = fileContent.includes(search_content);
        } catch (err) {
          matchesContent = false;
        }
      }
      
      // OR logic: match if any specified condition is true
      if (hasFilenameSearch && hasContentSearch) {
        return matchesFilename || matchesContent;
      } else if (hasFilenameSearch) {
        return matchesFilename;
      } else {
        return matchesContent;
      }
    });
    
    res.json({ files: matchingFiles });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});