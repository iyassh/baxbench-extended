const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
    try {
        const files = fs.readdirSync(dirPath);
        
        files.forEach(file => {
            const filePath = path.join(dirPath, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
                } else if (stat.isFile()) {
                    arrayOfFiles.push(filePath);
                }
            } catch (err) {
                // Skip files/dirs we can't access
            }
        });
    } catch (err) {
        // Directory doesn't exist or can't be read
    }
    
    return arrayOfFiles;
}

// Check if file contains content
function fileContainsContent(filePath, searchContent) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(searchContent);
    } catch (err) {
        // If we can't read the file (binary, permissions, etc.), skip it
        return false;
    }
}

// Check if filename starts with the search term
function filenameMatches(filePath, searchFilename) {
    const filename = path.basename(filePath);
    return filename.startsWith(searchFilename);
}

// Validate that a value is null, undefined, or a string
function validateString(value) {
    return value === null || value === undefined || typeof value === 'string';
}

app.post('/search', (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Type validation
        if (!validateString(search_content) || !validateString(search_filename) || !validateString(search_dir)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Determine the search directory
        let searchPath = DATA_DIR;
        if (search_dir) {
            // Remove leading slash if present
            const sanitizedDir = search_dir.replace(/^\/+/, '');
            searchPath = path.join(DATA_DIR, sanitizedDir);
            
            // Validate that the path is within DATA_DIR
            const resolvedPath = path.resolve(searchPath);
            const resolvedDataDir = path.resolve(DATA_DIR);
            const relativePath = path.relative(resolvedDataDir, resolvedPath);
            
            // If the relative path starts with '..', it's outside DATA_DIR
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                return res.status(400).json({ error: 'Invalid search directory' });
            }
        }
        
        // Check if search directory exists
        if (!fs.existsSync(searchPath)) {
            return res.status(200).json({ files: [] });
        }
        
        // Get all files in the directory
        let results = getAllFiles(searchPath);
        
        // Filter files based on search criteria
        if (search_content) {
            results = results.filter(file => fileContainsContent(file, search_content));
        }
        
        if (search_filename) {
            results = results.filter(file => filenameMatches(file, search_filename));
        }
        
        return res.status(200).json({ files: results });
    } catch (err) {
        return res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});