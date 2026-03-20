const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

// Middleware
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

// Helper function to validate and sanitize directory paths
function sanitizePath(userPath) {
    if (!userPath || typeof userPath !== 'string') {
        return '';
    }
    
    // Remove any null bytes
    userPath = userPath.replace(/\0/g, '');
    
    // Normalize the path and resolve it relative to DATA_DIR
    const normalized = path.normalize(userPath);
    const resolved = path.resolve(DATA_DIR, normalized);
    
    // Ensure the resolved path is within DATA_DIR
    if (!resolved.startsWith(path.resolve(DATA_DIR))) {
        return null; // Path traversal attempt detected
    }
    
    return resolved;
}

// Recursive function to search files
async function searchFiles(dir, searchContent, searchFilename, results = []) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            try {
                if (entry.isDirectory()) {
                    // Recursively search subdirectories
                    await searchFiles(fullPath, searchContent, searchFilename, results);
                } else if (entry.isFile()) {
                    let shouldInclude = false;
                    
                    // Check filename match
                    if (searchFilename && entry.name.startsWith(searchFilename)) {
                        shouldInclude = true;
                    }
                    
                    // Check content match if not already included and content search is requested
                    if (!shouldInclude && searchContent) {
                        try {
                            const stats = await fs.stat(fullPath);
                            // Only read files under 10MB to prevent memory issues
                            if (stats.size < 10 * 1024 * 1024) {
                                const content = await fs.readFile(fullPath, 'utf8');
                                if (content.includes(searchContent)) {
                                    shouldInclude = true;
                                }
                            }
                        } catch (err) {
                            // File might be binary or unreadable as text, skip it
                            continue;
                        }
                    }
                    
                    if (shouldInclude) {
                        results.push(fullPath);
                    }
                }
            } catch (err) {
                // Skip files/directories we can't access
                continue;
            }
        }
    } catch (err) {
        // Directory might not exist or be inaccessible
        return results;
    }
    
    return results;
}

// Search endpoint
app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate input
        if (!search_content && !search_filename) {
            return res.status(400).json({ 
                error: 'At least one of search_content or search_filename must be provided' 
            });
        }
        
        // Validate types
        if (search_content !== null && search_content !== undefined && typeof search_content !== 'string') {
            return res.status(400).json({ error: 'Invalid search_content type' });
        }
        if (search_filename !== null && search_filename !== undefined && typeof search_filename !== 'string') {
            return res.status(400).json({ error: 'Invalid search_filename type' });
        }
        if (search_dir !== null && search_dir !== undefined && typeof search_dir !== 'string') {
            return res.status(400).json({ error: 'Invalid search_dir type' });
        }
        
        // Determine search directory
        let searchPath = DATA_DIR;
        if (search_dir) {
            searchPath = sanitizePath(search_dir);
            if (!searchPath) {
                return res.status(400).json({ error: 'Invalid search directory' });
            }
        }
        
        // Check if the search directory exists
        try {
            const stats = await fs.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Search path is not a directory' });
            }
        } catch (err) {
            return res.status(400).json({ error: 'Search directory does not exist' });
        }
        
        // Perform the search
        const files = await searchFiles(
            searchPath, 
            search_content || null, 
            search_filename || null
        );
        
        res.json({ files });
        
    } catch (err) {
        // Don't expose internal error details
        console.error('Search error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    // Log error internally but don't expose details to client
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});