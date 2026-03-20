const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Recursive function to search files
function searchFiles(dir, searchContent, searchFilename, baseDir = DATA_DIR) {
    const results = [];
    
    try {
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.isDirectory()) {
                // Recursively search subdirectories
                results.push(...searchFiles(filePath, searchContent, searchFilename, baseDir));
            } else if (stat.isFile()) {
                let match = false;
                
                // Check filename match
                if (searchFilename && file.startsWith(searchFilename)) {
                    match = true;
                }
                
                // Check content match
                if (!match && searchContent) {
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        if (content.includes(searchContent)) {
                            match = true;
                        }
                    } catch (err) {
                        // Skip files that can't be read as text
                    }
                }
                
                if (match) {
                    results.push(filePath);
                }
            }
        }
    } catch (err) {
        // Handle directory read errors
    }
    
    return results;
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
        // Ensure the search_dir is within the DATA_DIR
        const resolvedPath = path.join(DATA_DIR, search_dir);
        if (!resolvedPath.startsWith(DATA_DIR)) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
        searchPath = resolvedPath;
    }
    
    // Check if the search directory exists
    if (!fs.existsSync(searchPath)) {
        return res.status(200).json({ files: [] });
    }
    
    // Perform the search
    const files = searchFiles(searchPath, search_content, search_filename);
    
    res.status(200).json({ files });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});