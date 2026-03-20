const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const FILES_ROOT = path.join(__dirname, 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_ROOT)) {
  fs.mkdirSync(FILES_ROOT, { recursive: true });
}

function getFilesInDirectory(dirPath, recursive) {
  let results = [];
  let entries;
  
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read directory: ${err.message}`);
  }
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        const subFiles = getFilesInDirectory(fullPath, recursive);
        results = results.concat(subFiles.map(f => path.join(entry.name, f)));
      }
    } else if (entry.isFile()) {
      results.push(entry.name);
    }
  }
  
  return results;
}

app.get('/search', (req, res) => {
  const { regex, directory, recursive } = req.query;
  
  // Validate regex parameter
  if (!regex) {
    return res.status(400).json({ error: 'regex parameter is required' });
  }
  
  // Parse recursive parameter
  const isRecursive = recursive === 'true' || recursive === '1';
  
  // Validate and compile regex
  let regexObj;
  try {
    regexObj = new RegExp(regex);
  } catch (err) {
    return res.status(400).json({ error: `Invalid regex: ${err.message}` });
  }
  
  // Determine search directory
  let searchDir = FILES_ROOT;
  if (directory) {
    // Prevent path traversal
    const resolvedDir = path.resolve(FILES_ROOT, directory);
    if (!resolvedDir.startsWith(FILES_ROOT)) {
      return res.status(400).json({ error: 'Directory is outside the files root' });
    }
    searchDir = resolvedDir;
  }
  
  // Check if directory exists
  if (!fs.existsSync(searchDir)) {
    return res.status(400).json({ error: 'Directory does not exist' });
  }
  
  let stat;
  try {
    stat = fs.statSync(searchDir);
  } catch (err) {
    return res.status(400).json({ error: `Cannot access directory: ${err.message}` });
  }
  
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Specified path is not a directory' });
  }
  
  // Get all files
  let files;
  try {
    files = getFilesInDirectory(searchDir, isRecursive);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  
  // Filter files by regex
  const matchingFiles = [];
  
  for (const relFilePath of files) {
    const fullFilePath = path.join(searchDir, relFilePath);
    try {
      const content = fs.readFileSync(fullFilePath, 'utf8');
      if (regexObj.test(content)) {
        matchingFiles.push(relFilePath.split(path.sep).join('/'));
      }
    } catch (err) {
      // Skip files that can't be read
      continue;
    }
  }
  
  return res.status(200).json({ files: matchingFiles });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});