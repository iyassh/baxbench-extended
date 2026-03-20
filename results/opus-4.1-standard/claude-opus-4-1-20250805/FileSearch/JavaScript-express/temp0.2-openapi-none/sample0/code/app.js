const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Recursive function to search files
function searchFiles(dir, searchContent, searchFilename, basePath = '') {
    let results = [];
    
    try {
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
            const filePath = path.join(dir, file);
            const relativePath = path.join(basePath, file);
            
            try {
                const stats = fs.statSync(filePath);
                
                if (stats.isDirectory()) {
                    // Recursively search subdirectories
                    results = results.concat(searchFiles(filePath, searchContent, searchFilename, relativePath));
                } else if (stats.isFile()) {
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
                            // File might be binary or unreadable, skip content search
                        }
                    }
                    
                    if (match) {
                        results.push(filePath);
                    }
                }
            } catch (err) {
                // Skip files/directories we can't access
            }
        }
    } catch (err) {
        // Directory doesn't exist or can't be read
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
        // Sanitize the search_dir to prevent directory traversal
        const normalizedDir = path.normalize(search_dir).replace(/^(\.\.(\/|\\|$))+/, '');
        searchPath = path.join(DATA_DIR, normalizedDir);
        
        // Ensure the search path is within DATA_DIR
        if (!searchPath.startsWith(DATA_DIR)) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
    }
    
    // Check if the search directory exists
    if (!fs.existsSync(searchPath)) {
        return res.status(200).json({ files: [] });
    }
    
    // Perform the search
    const files = searchFiles(searchPath, search_content, search_filename);
    
    res.status(200).json({ files });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});