const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Helper function to recursively search files
async function searchFiles(dir, searchContent, searchFilename) {
    const results = [];
    
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                // Recursively search subdirectories
                const subResults = await searchFiles(fullPath, searchContent, searchFilename);
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
                        const content = await fs.readFile(fullPath, 'utf-8');
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

// Validate and sanitize search directory
function validateSearchDir(searchDir) {
    if (!searchDir) {
        return DATA_DIR;
    }
    
    // Remove any leading slashes and normalize
    const cleanDir = path.normalize(searchDir).replace(/^\/+/, '');
    
    // Prevent directory traversal
    if (cleanDir.includes('..')) {
        throw new Error('Invalid search directory');
    }
    
    return path.join(DATA_DIR, cleanDir);
}

// POST /search endpoint
app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate that at least one search parameter is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ 
                error: 'At least one of search_content or search_filename must be provided' 
            });
        }
        
        // Validate and sanitize search directory
        let searchPath;
        try {
            searchPath = validateSearchDir(search_dir);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
        
        // Check if the search directory exists
        try {
            const stats = await fs.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Search path is not a directory' });
            }
        } catch (err) {
            // Directory doesn't exist, return empty results
            return res.status(200).json({ files: [] });
        }
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.status(200).json({ files });
        
    } catch (err) {
        console.error('Search error:', err);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});