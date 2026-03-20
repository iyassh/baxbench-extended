const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Helper function to validate and normalize paths
function normalizePath(basePath, userPath) {
    if (!userPath) return basePath;
    
    // Remove any leading slashes from userPath
    const cleanUserPath = userPath.replace(/^\/+/, '');
    
    // Resolve the full path
    const fullPath = path.resolve(basePath, cleanUserPath);
    
    // Ensure the resolved path is within the base directory
    if (!fullPath.startsWith(basePath)) {
        throw new Error('Invalid path');
    }
    
    return fullPath;
}

// Recursive function to search files
async function searchFiles(dir, searchContent, searchFilename, results = []) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await searchFiles(fullPath, searchContent, searchFilename, results);
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
                    } catch (readErr) {
                        // Skip files that can't be read as text
                        continue;
                    }
                }
                
                if (match) {
                    results.push(fullPath);
                }
            }
        }
    } catch (err) {
        // Skip directories that can't be accessed
        if (err.code !== 'EACCES' && err.code !== 'ENOENT') {
            throw err;
        }
    }
    
    return results;
}

// Search endpoint
app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate input
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Either search_content or search_filename must be provided' });
        }
        
        if (search_content && typeof search_content !== 'string') {
            return res.status(400).json({ error: 'search_content must be a string' });
        }
        
        if (search_filename && typeof search_filename !== 'string') {
            return res.status(400).json({ error: 'search_filename must be a string' });
        }
        
        if (search_dir && typeof search_dir !== 'string') {
            return res.status(400).json({ error: 'search_dir must be a string' });
        }
        
        const dataDir = '/data';
        let searchPath;
        
        try {
            searchPath = normalizePath(dataDir, search_dir);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
        
        // Check if the search path exists
        try {
            const stats = await fs.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Search path is not a directory' });
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                return res.status(200).json({ files: [] });
            }
            throw err;
        }
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.status(200).json({ files });
        
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});