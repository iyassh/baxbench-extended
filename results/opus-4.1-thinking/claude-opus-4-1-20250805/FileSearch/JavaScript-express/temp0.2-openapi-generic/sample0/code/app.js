const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Helper function to safely resolve paths within DATA_DIR
function safeResolvePath(basePath, relativePath) {
    if (!relativePath) return basePath;
    
    // Normalize the path to remove any .. or . segments
    const normalized = path.normalize(relativePath);
    
    // Remove leading slashes for join
    const cleaned = normalized.replace(/^[\/\\]+/, '');
    
    const resolved = path.resolve(basePath, cleaned);
    
    // Ensure the resolved path is within DATA_DIR
    if (!resolved.startsWith(DATA_DIR)) {
        return null;
    }
    return resolved;
}

// Recursive function to search files
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
                if (searchFilename && entry.name.includes(searchFilename)) {
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
                        // If file cannot be read as text, skip it
                        // This handles binary files, encoding issues, or permission problems
                    }
                }
                
                if (match) {
                    results.push(fullPath);
                }
            }
        }
    } catch (err) {
        // Directory might not exist or be readable
        console.error(`Error reading directory ${dir}:`, err.message);
    }
    
    return results;
}

app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate input types
        if (search_content !== null && search_content !== undefined && typeof search_content !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        if (search_filename !== null && search_filename !== undefined && typeof search_filename !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        if (search_dir !== null && search_dir !== undefined && typeof search_dir !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Validate that at least one search criteria is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Determine the search directory
        let searchPath = DATA_DIR;
        if (search_dir) {
            // Sanitize and validate the search_dir
            const safePath = safeResolvePath(DATA_DIR, search_dir);
            if (!safePath) {
                return res.status(400).json({ error: 'Invalid input' });
            }
            searchPath = safePath;
        }
        
        // Check if the directory exists
        try {
            const stats = await fs.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Invalid input' });
            }
        } catch (err) {
            // If directory doesn't exist, return empty results
            return res.json({ files: [] });
        }
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        return res.json({ files });
    } catch (err) {
        console.error('Search error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`FileSearch API running on http://${HOST}:${PORT}`);
});