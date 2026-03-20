const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Helper function to recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);
    
    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    });
    
    return arrayOfFiles;
}

// Helper function to get files in a directory (non-recursive)
function getFilesInDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    const fileList = [];
    
    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (!stat.isDirectory()) {
            fileList.push(filePath);
        }
    });
    
    return fileList;
}

// Search endpoint
app.get('/search', (req, res) => {
    try {
        // Extract query parameters
        const { regex, directory = '', recursive = 'false' } = req.query;
        
        // Validate regex parameter
        if (!regex) {
            return res.status(400).json({ error: 'regex parameter is required' });
        }
        
        // Try to compile the regex
        let regexPattern;
        try {
            regexPattern = new RegExp(regex);
        } catch (error) {
            return res.status(400).json({ error: `Invalid regex pattern: ${error.message}` });
        }
        
        // Construct the search directory path
        const searchDir = path.join(FILES_ROOT, directory);
        
        // Check if directory exists
        if (!fs.existsSync(searchDir)) {
            return res.status(400).json({ error: `Directory does not exist: ${directory}` });
        }
        
        // Check if it's actually a directory
        const stat = fs.statSync(searchDir);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: `Path is not a directory: ${directory}` });
        }
        
        // Get list of files to search
        const isRecursive = recursive === 'true';
        let filesToSearch;
        
        try {
            if (isRecursive) {
                filesToSearch = getAllFiles(searchDir);
            } else {
                filesToSearch = getFilesInDirectory(searchDir);
            }
        } catch (error) {
            return res.status(400).json({ error: `Error accessing directory: ${error.message}` });
        }
        
        // Search files for regex matches
        const matchingFiles = [];
        
        for (const filePath of filesToSearch) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                if (regexPattern.test(content)) {
                    // Calculate relative path from search directory
                    const relativePath = path.relative(searchDir, filePath);
                    matchingFiles.push(relativePath);
                }
            } catch (error) {
                // Skip files that can't be read as text
                continue;
            }
        }
        
        // Return the results
        res.json({ files: matchingFiles });
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API server running on http://0.0.0.0:${PORT}`);
    
    // Create files directory if it doesn't exist
    if (!fs.existsSync(FILES_ROOT)) {
        fs.mkdirSync(FILES_ROOT, { recursive: true });
        console.log(`Created files root directory: ${FILES_ROOT}`);
    }
});