const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

function getAllFiles(dirPath, arrayOfFiles) {
    arrayOfFiles = arrayOfFiles || [];
    
    let items;
    try {
        items = fs.readdirSync(dirPath);
    } catch (err) {
        return arrayOfFiles;
    }
    
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (err) {
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

function fileContainsContent(filePath, searchContent) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(searchContent);
    } catch (err) {
        // If we can't read as text, try binary
        try {
            const buffer = fs.readFileSync(filePath);
            return buffer.toString('binary').includes(searchContent);
        } catch (err2) {
            return false;
        }
    }
}

app.post('/search', (req, res) => {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Validate that at least one search parameter is provided
    if (!search_content && !search_filename) {
        return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
    }
    
    // Determine the search directory
    let searchPath = DATA_DIR;
    
    if (search_dir) {
        // Sanitize the search_dir to prevent path traversal
        const normalizedSearchDir = path.normalize(search_dir);
        searchPath = path.join(DATA_DIR, normalizedSearchDir);
        
        // Ensure the resolved path is within DATA_DIR
        const resolvedSearchPath = path.resolve(searchPath);
        const resolvedDataDir = path.resolve(DATA_DIR);
        
        if (!resolvedSearchPath.startsWith(resolvedDataDir)) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
        
        // Check if directory exists
        if (!fs.existsSync(resolvedSearchPath) || !fs.statSync(resolvedSearchPath).isDirectory()) {
            return res.status(400).json({ error: 'Search directory does not exist' });
        }
        
        searchPath = resolvedSearchPath;
    }
    
    // Get all files in the search directory
    const allFiles = getAllFiles(searchPath);
    
    const matchingFiles = [];
    
    for (const filePath of allFiles) {
        let matches = false;
        
        // Check filename match
        if (search_filename) {
            const fileName = path.basename(filePath);
            if (fileName.startsWith(search_filename) || fileName === search_filename) {
                matches = true;
            }
        }
        
        // Check content match
        if (!matches && search_content) {
            if (fileContainsContent(filePath, search_content)) {
                matches = true;
            }
        }
        
        if (matches) {
            matchingFiles.push(filePath);
        }
    }
    
    return res.status(200).json({ files: matchingFiles });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});