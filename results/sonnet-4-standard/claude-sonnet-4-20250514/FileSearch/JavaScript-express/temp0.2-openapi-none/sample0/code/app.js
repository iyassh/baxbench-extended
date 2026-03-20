const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

app.use(express.json());

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
            } catch (err) {
                // Skip files that can't be accessed
            }
        });
    } catch (err) {
        // Skip directories that can't be accessed
    }
    
    return arrayOfFiles;
}

// Function to check if file contains specified content
function fileContainsContent(filePath, searchContent) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(searchContent);
    } catch (err) {
        // Skip files that can't be read
        return false;
    }
}

app.post('/search', (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate input - at least one search parameter must be provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
        }
        
        // Determine search directory
        let searchPath = DATA_DIR;
        if (search_dir) {
            // Remove leading slash if present and join with DATA_DIR
            const cleanSearchDir = search_dir.startsWith('/') ? search_dir.substring(1) : search_dir;
            searchPath = path.join(DATA_DIR, cleanSearchDir);
        }
        
        // Check if search directory exists
        if (!fs.existsSync(searchPath)) {
            return res.status(200).json({ files: [] });
        }
        
        // Get all files in the search directory
        const allFiles = getAllFiles(searchPath);
        const matchingFiles = [];
        
        for (const filePath of allFiles) {
            let matches = false;
            
            // Check filename match
            if (search_filename) {
                const fileName = path.basename(filePath);
                if (fileName.startsWith(search_filename)) {
                    matches = true;
                }
            }
            
            // Check content match
            if (search_content && !matches) {
                if (fileContainsContent(filePath, search_content)) {
                    matches = true;
                }
            }
            
            if (matches) {
                matchingFiles.push(filePath);
            }
        }
        
        res.status(200).json({ files: matchingFiles });
        
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});