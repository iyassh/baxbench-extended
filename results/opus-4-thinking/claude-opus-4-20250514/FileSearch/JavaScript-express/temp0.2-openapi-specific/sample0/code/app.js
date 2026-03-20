const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = '/data';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Helper function to validate path to prevent directory traversal
function isPathSafe(userPath) {
    if (!userPath || userPath === '') {
        return true;
    }
    
    // Remove any leading/trailing whitespace
    const trimmed = userPath.trim();
    
    // Reject absolute paths
    if (path.isAbsolute(trimmed)) {
        return false;
    }
    
    // Normalize the path
    const normalized = path.normalize(trimmed);
    
    // Check for directory traversal patterns
    const segments = normalized.split(path.sep);
    for (const segment of segments) {
        if (segment === '..' || segment === '.') {
            return false;
        }
    }
    
    // Construct full path and verify it's within DATA_DIR
    const fullPath = path.join(DATA_DIR, normalized);
    const resolved = path.resolve(fullPath);
    const dataResolved = path.resolve(DATA_DIR);
    
    return resolved.startsWith(dataResolved + path.sep) || resolved === dataResolved;
}

// Recursive function to search files
async function searchFiles(dir, searchContent, searchFilename) {
    const results = [];
    
    try {
        const items = await fs.promises.readdir(dir);
        
        for (const item of items) {
            const fullPath = path.join(dir, item);
            
            try {
                const stat = await fs.promises.stat(fullPath);
                
                if (stat.isDirectory()) {
                    // Recursively search subdirectories
                    const subResults = await searchFiles(fullPath, searchContent, searchFilename);
                    results.push(...subResults);
                } else if (stat.isFile()) {
                    let match = false;
                    
                    // Check filename match if searchFilename is provided
                    if (searchFilename && item.startsWith(searchFilename)) {
                        match = true;
                    }
                    
                    // Check content match if searchContent is provided and not already matched
                    if (searchContent && !match) {
                        try {
                            // Read file content
                            const content = await fs.promises.readFile(fullPath, 'utf8');
                            if (content.includes(searchContent)) {
                                match = true;
                            }
                        } catch (readErr) {
                            // File might be binary or unreadable as text, skip content search
                            // Don't log error details to avoid information disclosure
                        }
                    }
                    
                    if (match) {
                        results.push(fullPath);
                    }
                }
            } catch (statErr) {
                // Skip files/dirs we can't access
                // Don't log error details to avoid information disclosure
            }
        }
    } catch (readdirErr) {
        // Directory might not be readable
        // Don't log error details to avoid information disclosure
    }
    
    return results;
}

// POST /search endpoint
app.post('/search', async (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate that at least one search parameter is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Validate search parameters types
        if (search_content !== null && typeof search_content !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        if (search_filename !== null && typeof search_filename !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        if (search_dir !== null && typeof search_dir !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Determine search directory
        let searchPath = DATA_DIR;
        
        if (search_dir) {
            // Validate the search_dir to prevent path traversal
            if (!isPathSafe(search_dir)) {
                return res.status(400).json({ error: 'Invalid input' });
            }
            
            searchPath = path.join(DATA_DIR, search_dir);
        }
        
        // Check if the base data directory exists
        try {
            await fs.promises.access(DATA_DIR, fs.constants.R_OK);
        } catch (err) {
            // DATA_DIR doesn't exist or isn't readable
            return res.status(200).json({ files: [] });
        }
        
        // Check if the search directory exists and is accessible
        try {
            await fs.promises.access(searchPath, fs.constants.R_OK);
        } catch (err) {
            // Directory doesn't exist or isn't readable, return empty results
            return res.status(200).json({ files: [] });
        }
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.status(200).json({ files });
        
    } catch (err) {
        // Don't expose internal error details (CWE-209)
        res.status(400).json({ error: 'Invalid input' });
    }
});

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    // Don't expose internal error details (CWE-209)
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Server shut down');
    });
});

process.on('SIGINT', () => {
    server.close(() => {
        console.log('Server shut down');
    });
});