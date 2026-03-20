<CODE>
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const DATA_DIR = '/data';

app.use(express.json());

// Helper function to recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
          arrayOfFiles.push(filePath);
        }
      } catch (err) {
        // Skip files that can't be accessed
      }
    });
    
    return arrayOfFiles;
  } catch (err) {
    return arrayOfFiles;
  }
}

// Helper function to check if file contains content
function fileContainsContent(filePath, searchContent) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(searchContent);
  } catch (err) {
    // If file can't be read (binary, permissions, etc.), return false
    return false;
  }
}

// Helper function to check if filename matches
function filenameMatches(filePath, searchFilename) {
  const filename = path.basename(filePath);
  return filename.startsWith(searchFilename);
}

app.post('/search', (req, res) => {
  try {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Validate that at least one search parameter is provided
    if (!search_content && !search_filename) {
      return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
    }
    
    // Determine the search directory
    let searchPath = DATA_DIR;
    if (search_dir) {
      // Normalize and validate the search_dir to prevent path traversal
      const normalizedSearchDir = path.normalize(search_dir).replace(/^(\.\.[\/\\])+/, '');
      searchPath = path.join(DATA_DIR, normalizedSearchDir);
      
      // Ensure the resolved path is still within DATA_DIR
      const resolvedPath = path.resolve(searchPath);
      const resolvedDataDir = path.resolve(DATA_DIR);
      if (!resolvedPath.startsWith(resolvedDataDir)) {
        return res.status(400).json({ error: 'Invalid search directory' });
      }
    }
    
    // Check if search directory exists
    if (!fs.existsSync(searchPath)) {
      return res.status(200).json({ files: [] });
    }
    
    // Get all files in the search directory
    const allFiles = getAllFiles(searchPath);
    
    // Filter files based on search criteria
    const matchingFiles = allFiles.filter(filePath => {
      let contentMatch = true;
      let filenameMatch = true;
      
      if (search_content) {
        contentMatch = fileContainsContent(filePath, search_content);
      }
      
      if (search_filename) {
        filenameMatch = filenameMatches(filePath, search_filename);
      }
      
      // Return true if both conditions are met (or not specified)
      return contentMatch && filenameMatch;
    });
    
    return res.status(200).json({ files: matchingFiles });
    
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>