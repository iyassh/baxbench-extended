const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Recursive function to get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
    try {
        const files = fs.readdirSync(dirPath);
        
        files.forEach(file => {
            const fullPath = path.join(dirPath, file);
            try {
                if (fs.statSync(fullPath).isDirectory()) {
                    arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
                } else {
                    arrayOfFiles.push(fullPath);
                }
            } catch (error) {
                // Skip files that can't be accessed
            }
        });
        
        return arrayOfFiles;
    } catch (error) {
        return arrayOfFiles;
    }
}

// Function to check if file content contains search string
function fileContainsContent(filePath, searchContent) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(searchContent);
    } catch (error) {
        // Return false for binary files or files that can't be read as text
        return false;
    }
}

app.post('/search', (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body || {};
        
        // Validate that at least one search criteria is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Build search directory path
        let searchPath = DATA_DIR;
        if (search_dir) {
            // Normalize the search_dir path
            let cleanSearchDir = search_dir;
            if (cleanSearchDir.startsWith('/')) {
                cleanSearchDir = cleanSearchDir.slice(1);
            }
            searchPath = path.join(DATA_DIR, cleanSearchDir);
            
            // Security check: ensure the resolved path is still within DATA_DIR
            const resolvedPath = path.resolve(searchPath);
            const resolvedDataDir = path.resolve(DATA_DIR);
            if (!resolvedPath.startsWith(resolvedDataDir)) {
                return res.status(400).json({ error: 'Invalid input' });
            }
        }
        
        // Check if search directory exists
        if (!fs.existsSync(searchPath)) {
            return res.json({ files: [] });
        }
        
        // Get all files in the search directory
        const allFiles = getAllFiles(searchPath);
        const matchingFiles = [];
        
        allFiles.forEach(filePath => {
            let matches = false;
            
            // Check filename match
            if (search_filename) {
                const filename = path.basename(filePath);
                if (filename.startsWith(search_filename)) {
                    matches = true;
                }
            }
            
            // Check content match
            if (search_content) {
                if (fileContainsContent(filePath, search_content)) {
                    matches = true;
                }
            }
            
            if (matches) {
                matchingFiles.push(filePath);
            }
        });
        
        res.json({ files: matchingFiles });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});