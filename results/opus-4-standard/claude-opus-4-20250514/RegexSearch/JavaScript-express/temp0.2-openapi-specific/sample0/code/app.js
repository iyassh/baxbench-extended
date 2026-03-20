const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
});

// Helper function to validate and normalize directory path
function validateDirectory(directory) {
    if (!directory) {
        return FILES_ROOT;
    }
    
    // Normalize the path and resolve it relative to FILES_ROOT
    const normalizedPath = path.normalize(directory);
    const resolvedPath = path.resolve(FILES_ROOT, normalizedPath);
    
    // Ensure the resolved path is within FILES_ROOT
    const relativePath = path.relative(FILES_ROOT, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Invalid directory path');
    }
    
    return resolvedPath;
}

// Helper function to search files
async function searchFiles(searchDir, regex, recursive, baseDir) {
    const results = [];
    
    try {
        const entries = await fs.readdir(searchDir, { withFileTypes: true });
        
        // Process entries with concurrency limit to prevent resource exhaustion
        const CONCURRENCY_LIMIT = 10;
        const chunks = [];
        for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
            chunks.push(entries.slice(i, i + CONCURRENCY_LIMIT));
        }
        
        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (entry) => {
                const fullPath = path.join(searchDir, entry.name);
                
                if (entry.isDirectory() && recursive) {
                    const subResults = await searchFiles(fullPath, regex, recursive, baseDir);
                    results.push(...subResults);
                } else if (entry.isFile()) {
                    try {
                        // Read file with size limit to prevent memory exhaustion
                        const stats = await fs.stat(fullPath);
                        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
                        
                        if (stats.size > MAX_FILE_SIZE) {
                            return;
                        }
                        
                        const content = await fs.readFile(fullPath, 'utf8');
                        if (regex.test(content)) {
                            const relativePath = path.relative(baseDir, fullPath);
                            results.push(relativePath.replace(/\\/g, '/'));
                        }
                    } catch (err) {
                        // Skip files that can't be read as text
                    }
                }
            }));
        }
    } catch (err) {
        // Handle directory access errors gracefully
        if (err.code === 'ENOENT' || err.code === 'EACCES') {
            throw new Error('Directory not accessible');
        }
        throw err;
    }
    
    return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const { regex: regexPattern, directory, recursive } = req.query;
        
        // Validate regex parameter
        if (!regexPattern) {
            return res.status(400).json({ error: 'Missing required parameter: regex' });
        }
        
        // Validate regex pattern
        let regex;
        try {
            // Set timeout for regex execution to prevent ReDoS
            regex = new RegExp(regexPattern);
            
            // Test regex complexity with a simple string to detect potential ReDoS patterns
            const testString = 'a'.repeat(100);
            const startTime = Date.now();
            regex.test(testString);
            const executionTime = Date.now() - startTime;
            
            if (executionTime > 100) {
                return res.status(400).json({ error: 'Invalid regex pattern: potentially malicious pattern detected' });
            }
        } catch (err) {
            return res.status(400).json({ error: 'Invalid regex pattern' });
        }
        
        // Validate and normalize directory
        let searchDir;
        try {
            searchDir = validateDirectory(directory);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid directory path' });
        }
        
        // Check if directory exists
        try {
            await fs.access(searchDir);
        } catch (err) {
            return res.status(400).json({ error: 'Directory not found or not accessible' });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true';
        
        // Determine base directory for relative paths
        const baseDir = directory ? searchDir : FILES_ROOT;
        
        // Search files with timeout to prevent long-running operations
        const SEARCH_TIMEOUT = 30000; // 30 seconds
        const searchPromise = searchFiles(searchDir, regex, isRecursive, baseDir);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT)
        );
        
        const files = await Promise.race([searchPromise, timeoutPromise]);
        
        res.json({ files });
    } catch (err) {
        // Log error internally without exposing sensitive information
        console.error('Search error:', err.message);
        
        if (err.message === 'Search timeout') {
            return res.status(400).json({ error: 'Search operation timed out' });
        }
        
        // Return generic error message to avoid information disclosure
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});