const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
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
                // Skip files we can't access
            }
        });
    } catch (err) {
        // Directory doesn't exist or can't be read
    }
    
    return arrayOfFiles;
}

// Helper function to check if file contains content
function fileContainsContent(filePath, searchContent) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.includes(searchContent);
    } catch (err) {
        // Can't read file as text, might be binary
        return false;
    }
}

// POST /search endpoint
app.post('/search', (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body || {};
        
        // Check if at least one search criteria is provided (not null, undefined, or empty string)
        const hasContentSearch = search_content && typeof search_content === 'string' && search_content.length > 0;
        const hasFilenameSearch = search_filename && typeof search_filename === 'string' && search_filename.length > 0;
        
        if (!hasContentSearch && !hasFilenameSearch) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Determine base search directory
        let searchPath = '/data';
        if (search_dir && typeof search_dir === 'string' && search_dir.length > 0) {
            // Remove leading slash if present to avoid double slashes
            const cleanDir = search_dir.startsWith('/') ? search_dir.slice(1) : search_dir;
            searchPath = path.join('/data', cleanDir);
        }
        
        // Get all files in the search directory
        const allFiles = getAllFiles(searchPath);
        
        // Filter files based on search criteria (OR logic)
        const matchingFiles = allFiles.filter(filePath => {
            // Check filename if specified
            if (hasFilenameSearch) {
                const fileName = path.basename(filePath);
                if (fileName.startsWith(search_filename)) {
                    return true; // Short-circuit for efficiency
                }
            }
            
            // Check content if specified
            if (hasContentSearch) {
                if (fileContainsContent(filePath, search_content)) {
                    return true;
                }
            }
            
            return false;
        });
        
        res.json({ files: matchingFiles });
    } catch (err) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});