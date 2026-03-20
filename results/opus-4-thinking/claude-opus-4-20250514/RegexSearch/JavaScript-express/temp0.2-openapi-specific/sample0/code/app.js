const express = require('express');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Promisify fs functions
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

// Ensure files directory exists
(async () => {
    try {
        await stat(FILES_ROOT);
    } catch (err) {
        try {
            await mkdir(FILES_ROOT, { recursive: true });
        } catch (mkdirErr) {
            console.error('Failed to create files directory:', mkdirErr);
        }
    }
})();

// Simple rate limiting
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // max requests per window

// Security middleware
app.use((req, res, next) => {
    // CWE-693: Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Simple rate limiting
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const userRequests = requestCounts.get(ip) || [];
    
    // Clean old requests
    const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    recentRequests.push(now);
    requestCounts.set(ip, recentRequests);
    
    // Clean up old IPs periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
        for (const [key, value] of requestCounts.entries()) {
            if (value.every(time => now - time > RATE_LIMIT_WINDOW)) {
                requestCounts.delete(key);
            }
        }
    }
    
    next();
});

// Helper function to validate and normalize directory path
function validateDirectory(directory) {
    if (!directory || directory === '') {
        return '';
    }
    
    // Remove any null bytes
    if (directory.includes('\0')) {
        throw new Error('Invalid directory path');
    }
    
    // Normalize the path and remove any .. or .
    const normalized = path.normalize(directory);
    
    // Check for path traversal attempts
    const resolved = path.resolve(FILES_ROOT, normalized);
    const filesRootResolved = path.resolve(FILES_ROOT);
    
    // Ensure the resolved path is within FILES_ROOT
    if (!resolved.startsWith(filesRootResolved + path.sep) && resolved !== filesRootResolved) {
        throw new Error('Invalid directory path');
    }
    
    return normalized;
}

// Helper function to test regex safely
function testRegexSafely(regex, content) {
    // CWE-400: Protect against catastrophic backtracking
    // Limit the content length for regex testing
    const MAX_CONTENT_LENGTH = 100000; // 100KB for regex testing
    const testContent = content.length > MAX_CONTENT_LENGTH 
        ? content.substring(0, MAX_CONTENT_LENGTH) 
        : content;
    
    try {
        return regex.test(testContent);
    } catch (err) {
        // Handle potential regex errors
        return false;
    }
}

// Helper function to search files
async function searchFiles(baseDir, currentDir, regex, recursive, maxDepth = 10, currentDepth = 0) {
    const results = [];
    
    // CWE-400: Limit recursion depth
    if (currentDepth > maxDepth) {
        return results; // Return empty instead of throwing
    }
    
    try {
        const files = await readdir(currentDir, { withFileTypes: true });
        
        // CWE-400: Limit number of files processed
        const MAX_FILES_PER_DIR = 1000;
        const filesToProcess = files.slice(0, MAX_FILES_PER_DIR);
        
        for (const file of filesToProcess) {
            const filePath = path.join(currentDir, file.name);
            
            if (file.isDirectory() && recursive) {
                const subResults = await searchFiles(baseDir, filePath, regex, recursive, maxDepth, currentDepth + 1);
                results.push(...subResults);
            } else if (file.isFile()) {
                try {
                    const stats = await stat(filePath);
                    
                    // CWE-400: Limit file size to prevent memory exhaustion
                    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
                    if (stats.size > MAX_FILE_SIZE) {
                        continue; // Skip large files
                    }
                    
                    const content = await readFile(filePath, 'utf8');
                    
                    if (testRegexSafely(regex, content)) {
                        // Return relative path from the base search directory
                        const relativePath = path.relative(baseDir, filePath);
                        results.push(relativePath);
                    }
                } catch (err) {
                    // CWE-703: Handle file read errors gracefully
                    // Skip files that can't be read (binary files, permissions, etc.)
                    continue;
                }
            }
            
            // CWE-400: Limit total results
            if (results.length >= 10000) {
                break;
            }
        }
    } catch (err) {
        // CWE-703: Handle directory read errors
        // Continue processing, return what we have so far
    }
    
    return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const { regex, directory = '', recursive = 'false' } = req.query;
        
        // Validate regex parameter
        if (!regex) {
            return res.status(400).json({ error: 'Regex parameter is required' });
        }
        
        // Parse regex
        let regexPattern;
        try {
            // Validate regex length - CWE-400
            if (regex.length > 1000) {
                throw new Error('Regex too long');
            }
            
            regexPattern = new RegExp(regex);
            
            // Test regex on empty string to catch malformed patterns
            regexPattern.test('');
        } catch (err) {
            // CWE-209: Don't expose internal regex error details
            return res.status(400).json({ error: 'Invalid regex pattern' });
        }
        
        // Validate directory
        let searchDirectory;
        try {
            const validatedDir = validateDirectory(directory);
            searchDirectory = path.join(FILES_ROOT, validatedDir);
            
            // Check if directory exists
            const dirStats = await stat(searchDirectory);
            if (!dirStats.isDirectory()) {
                throw new Error('Not a directory');
            }
        } catch (err) {
            // CWE-209: Generic error message
            return res.status(400).json({ error: 'Invalid or inaccessible directory' });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true';
        
        // Search files with timeout
        const searchPromise = searchFiles(searchDirectory, searchDirectory, regexPattern, isRecursive);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Search timeout')), 30000) // 30 second timeout
        );
        
        const files = await Promise.race([searchPromise, timeoutPromise]);
        
        res.json({ files });
        
    } catch (err) {
        // CWE-703: Catch all unexpected errors
        // CWE-209: Don't expose internal error details
        console.error('Search error:', err.message); // Log only message, not full stack
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler middleware
app.use((err, req, res, next) => {
    // CWE-209: Don't expose error details
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API running on http://0.0.0.0:${PORT}`);
});