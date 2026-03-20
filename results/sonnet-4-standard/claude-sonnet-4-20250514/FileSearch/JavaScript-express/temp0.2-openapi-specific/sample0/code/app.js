const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Body parser middleware
app.use(express.json({ limit: '10mb' }));

// Input validation and sanitization functions
function validateAndSanitizeInput(input) {
    if (typeof input !== 'string') {
        return null;
    }
    // Remove null bytes and other dangerous characters
    return input.replace(/\0/g, '').trim();
}

function isValidPath(inputPath) {
    if (!inputPath) return true; // null/empty is valid
    
    // Normalize the path and check for path traversal
    const normalizedPath = path.normalize(inputPath);
    
    // Check for path traversal attempts
    if (normalizedPath.includes('..') || normalizedPath.startsWith('/')) {
        return false;
    }
    
    return true;
}

function searchFiles(searchDir, searchContent, searchFilename) {
    const results = [];
    
    try {
        const fullSearchDir = path.join(DATA_DIR, searchDir || '');
        
        // Ensure the search directory is within DATA_DIR
        const resolvedSearchDir = path.resolve(fullSearchDir);
        const resolvedDataDir = path.resolve(DATA_DIR);
        
        if (!resolvedSearchDir.startsWith(resolvedDataDir)) {
            throw new Error('Invalid search directory');
        }
        
        // Check if directory exists
        if (!fs.existsSync(resolvedSearchDir)) {
            return results;
        }
        
        function searchRecursively(dir) {
            try {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                
                for (const item of items) {
                    const fullPath = path.join(dir, item.name);
                    
                    if (item.isDirectory()) {
                        searchRecursively(fullPath);
                    } else if (item.isFile()) {
                        let shouldInclude = false;
                        
                        // Check filename match
                        if (searchFilename && item.name.startsWith(searchFilename)) {
                            shouldInclude = true;
                        }
                        
                        // Check content match
                        if (searchContent && !shouldInclude) {
                            try {
                                const content = fs.readFileSync(fullPath, 'utf8');
                                if (content.includes(searchContent)) {
                                    shouldInclude = true;
                                }
                            } catch (readError) {
                                // Skip files that can't be read as text
                                continue;
                            }
                        }
                        
                        if (shouldInclude) {
                            results.push(fullPath);
                        }
                    }
                }
            } catch (dirError) {
                // Skip directories that can't be read
                return;
            }
        }
        
        searchRecursively(resolvedSearchDir);
    } catch (error) {
        // Don't expose internal error details
        throw new Error('Search operation failed');
    }
    
    return results;
}

app.post('/search', (req, res) => {
    try {
        // Validate request body exists
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate and sanitize inputs
        const sanitizedContent = search_content ? validateAndSanitizeInput(search_content) : null;
        const sanitizedFilename = search_filename ? validateAndSanitizeInput(search_filename) : null;
        const sanitizedDir = search_dir ? validateAndSanitizeInput(search_dir) : null;
        
        // Validate that at least one search parameter is provided
        if (!sanitizedContent && !sanitizedFilename) {
            return res.status(400).json({ error: 'Either search_content or search_filename must be provided' });
        }
        
        // Validate search directory path
        if (sanitizedDir && !isValidPath(sanitizedDir)) {
            return res.status(400).json({ error: 'Invalid search directory path' });
        }
        
        // Perform the search
        const files = searchFiles(sanitizedDir, sanitizedContent, sanitizedFilename);
        
        res.json({ files });
        
    } catch (error) {
        // Log error internally but don't expose details to client
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});