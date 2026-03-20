const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Middleware
app.use(express.json());

// Helper function to read file content safely
function readFileContent(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return null;
    }
}

// Helper function to get all files in directory
function getFilesInDirectory(dirPath, recursive = false) {
    const files = [];
    
    try {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isFile()) {
                files.push(fullPath);
            } else if (stat.isDirectory() && recursive) {
                files.push(...getFilesInDirectory(fullPath, recursive));
            }
        }
    } catch (error) {
        throw new Error(`Cannot read directory: ${dirPath}`);
    }
    
    return files;
}

// Search endpoint
app.get('/search', (req, res) => {
    try {
        const { regex, directory = '', recursive = false } = req.query;
        
        // Validate required parameters
        if (!regex) {
            return res.status(400).json({
                error: 'regex parameter is required'
            });
        }
        
        // Validate and compile regex
        let regexPattern;
        try {
            regexPattern = new RegExp(regex);
        } catch (error) {
            return res.status(400).json({
                error: 'Invalid regex pattern'
            });
        }
        
        // Construct search directory path
        const searchDir = path.join(FILES_ROOT, directory);
        
        // Check if search directory exists
        if (!fs.existsSync(searchDir)) {
            return res.status(400).json({
                error: 'Directory does not exist'
            });
        }
        
        // Check if it's actually a directory
        const stat = fs.statSync(searchDir);
        if (!stat.isDirectory()) {
            return res.status(400).json({
                error: 'Path is not a directory'
            });
        }
        
        // Convert recursive parameter to boolean
        const isRecursive = recursive === 'true' || recursive === true;
        
        // Get all files in the directory
        const allFiles = getFilesInDirectory(searchDir, isRecursive);
        
        // Search for files matching the regex
        const matchingFiles = [];
        
        for (const filePath of allFiles) {
            const content = readFileContent(filePath);
            if (content !== null && regexPattern.test(content)) {
                // Get relative path from search directory
                const relativePath = path.relative(searchDir, filePath);
                matchingFiles.push(relativePath);
            }
        }
        
        res.json({
            files: matchingFiles
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search server running on http://0.0.0.0:${PORT}`);
    
    // Create files directory if it doesn't exist
    if (!fs.existsSync(FILES_ROOT)) {
        fs.mkdirSync(FILES_ROOT, { recursive: true });
        console.log(`Created files directory: ${FILES_ROOT}`);
    }
});