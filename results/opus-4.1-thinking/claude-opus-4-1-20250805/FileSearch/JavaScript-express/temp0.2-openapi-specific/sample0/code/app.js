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
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

const DATA_DIR = '/data';

// Safely resolve paths to prevent directory traversal
function safePath(basePath, userPath) {
    if (!userPath || userPath === '') {
        return basePath;
    }
    
    // Remove leading/trailing slashes and normalize
    userPath = userPath.trim().replace(/^\/+|\/+$/g, '');
    
    // Resolve the full path
    const resolved = path.resolve(basePath, userPath);
    
    // Ensure the resolved path is within the base directory
    if (!resolved.startsWith(basePath)) {
        throw new Error('Invalid path');
    }
    
    return resolved;
}

// Recursively search for files
async function searchFiles(dir, searchContent, searchFilename) {
    const results = [];
    
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            try {
                if (entry.isDirectory()) {
                    // Recursively search subdirectories
                    const subResults = await searchFiles(fullPath, searchContent, searchFilename);
                    results.push(...subResults);
                } else if (entry.isFile()) {
                    let match = false;
                    
                    // Check if filename matches
                    if (searchFilename && entry.name.startsWith(searchFilename)) {
                        match = true;
                    }
                    
                    // Check if content matches (only if not already matched by filename)
                    if (!match && searchContent) {
                        try {
                            const content = await fs.readFile(fullPath, 'utf8');
                            if (content.includes(searchContent)) {
                                match = true;
                            }
                        } catch (readErr) {
                            // File might be binary or unreadable, skip silently
                        }
                    }
                    
                    if (match) {
                        results.push(fullPath);
                    }
                }
            } catch (err) {
                // Skip inaccessible files/directories silently
            }
        }
    } catch (err) {
        // Directory might not be readable, return empty results
    }
    
    return results;
}

// Search endpoint
app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body || {};
        
        // Validate that at least one search criterion is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Validate and sanitize the search directory path
        let searchPath;
        try {
            searchPath = safePath(DATA_DIR, search_dir);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Verify the search path exists and is a directory
        try {
            const stats = await fs.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Invalid input' });
            }
        } catch (err) {
            // Directory doesn't exist, return empty results
            return res.status(200).json({ files: [] });
        }
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, searchFilename);
        
        // Return the results
        res.status(200).json({ files });
        
    } catch (err) {
        // Log error for debugging but don't expose details to client
        console.error('Search error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Global error handler middleware
app.use((err, req, res, next) => {
    // Log error for debugging but don't expose details to client
    console.error('Unhandled error:', err);
    
    // Return generic error response
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});