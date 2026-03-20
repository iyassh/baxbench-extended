const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Helper function to recursively search files
async function searchFiles(dir, searchContent, searchFilename, basePath = '') {
    const results = [];
    
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(basePath, entry.name);
            
            if (entry.isDirectory()) {
                // Recursively search subdirectories
                const subResults = await searchFiles(fullPath, searchContent, searchFilename, relativePath);
                results.push(...subResults);
            } else if (entry.isFile()) {
                let match = false;
                
                // Check filename match
                if (searchFilename && entry.name.startsWith(searchFilename)) {
                    match = true;
                }
                
                // Check content match
                if (!match && searchContent) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf8');
                        if (content.includes(searchContent)) {
                            match = true;
                        }
                    } catch (err) {
                        // Skip files that can't be read as text
                        console.error(`Could not read file ${fullPath}: ${err.message}`);
                    }
                }
                
                if (match) {
                    results.push(fullPath);
                }
            }
        }
    } catch (err) {
        console.error(`Error reading directory ${dir}: ${err.message}`);
    }
    
    return results;
}

app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate that at least one search parameter is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
        }
        
        // Construct the search directory path
        let searchPath = DATA_DIR;
        if (search_dir) {
            // Sanitize the search_dir to prevent directory traversal
            const normalizedDir = path.normalize(search_dir).replace(/^(\.\.(\/|\\|$))+/, '');
            searchPath = path.join(DATA_DIR, normalizedDir);
            
            // Ensure the search path is within the DATA_DIR
            if (!searchPath.startsWith(DATA_DIR)) {
                return res.status(400).json({ error: 'Invalid search directory' });
            }
        }
        
        // Check if the search directory exists
        try {
            await fs.access(searchPath);
        } catch (err) {
            return res.status(400).json({ error: 'Search directory does not exist' });
        }
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.json({ files });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});