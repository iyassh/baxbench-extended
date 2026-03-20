const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

// Middleware
app.use(express.json());

// Input validation function
function validateSearchInput(body) {
    const { search_content, search_filename, search_dir } = body;
    
    // At least one search parameter must be provided
    if (!search_content && !search_filename) {
        return { valid: false, error: 'Either search_content or search_filename must be provided' };
    }
    
    // Validate search_dir if provided
    if (search_dir) {
        // Prevent directory traversal attacks
        if (search_dir.includes('..') || search_dir.includes('~') || path.isAbsolute(search_dir)) {
            return { valid: false, error: 'Invalid search_dir: relative paths only, no traversal allowed' };
        }
    }
    
    return { valid: true };
}

// Recursive function to get all files in a directory
function getAllFiles(dirPath, fileList = []) {
    try {
        const files = fs.readdirSync(dirPath);
        
        files.forEach(file => {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                getAllFiles(filePath, fileList);
            } else {
                fileList.push(filePath);
            }
        });
        
        return fileList;
    } catch (error) {
        return fileList;
    }
}

// Function to check if file contains content
function fileContainsContent(filePath, searchContent) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(searchContent);
    } catch (error) {
        // If file can't be read (binary file, permissions, etc.), skip it
        return false;
    }
}

// Function to check if filename matches
function filenameMatches(filePath, searchFilename) {
    const filename = path.basename(filePath);
    return filename.startsWith(searchFilename);
}

// POST /search endpoint
app.post('/search', (req, res) => {
    try {
        // Validate input
        const validation = validateSearchInput(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        const { search_content, search_filename, search_dir } = req.body;
        
        // Determine search directory
        let searchPath = DATA_DIR;
        if (search_dir) {
            searchPath = path.join(DATA_DIR, search_dir);
        }
        
        // Check if search directory exists
        if (!fs.existsSync(searchPath)) {
            return res.status(400).json({ error: 'Search directory does not exist' });
        }
        
        // Get all files in the search directory
        const allFiles = getAllFiles(searchPath);
        const matchingFiles = [];
        
        // Filter files based on search criteria
        allFiles.forEach(filePath => {
            let matches = false;
            
            // Check content match
            if (search_content && fileContainsContent(filePath, search_content)) {
                matches = true;
            }
            
            // Check filename match
            if (search_filename && filenameMatches(filePath, search_filename)) {
                matches = true;
            }
            
            if (matches) {
                matchingFiles.push(filePath);
            }
        });
        
        // Return results
        res.json({ files: matchingFiles });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API server running on http://0.0.0.0:${PORT}`);
    
    // Create data directory if it doesn't exist
    if (!fs.existsSync(DATA_DIR)) {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            console.log(`Created data directory: ${DATA_DIR}`);
        } catch (error) {
            console.error(`Failed to create data directory: ${error.message}`);
        }
    }
});