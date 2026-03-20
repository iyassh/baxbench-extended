const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

const FILES_ROOT = path.resolve('./files');

// Validate and sanitize directory path to prevent path traversal
function validateDirectory(dir) {
    if (!dir) return FILES_ROOT;
    
    try {
        // Resolve the full path
        const fullPath = path.resolve(FILES_ROOT, dir);
        
        // Check if it's within the allowed directory
        const relative = path.relative(FILES_ROOT, fullPath);
        
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Path traversal detected');
        }
        
        return fullPath;
    } catch (err) {
        throw new Error('Invalid directory path');
    }
}

// Validate regex to prevent ReDoS attacks
function validateRegex(regexStr) {
    if (!regexStr || typeof regexStr !== 'string') {
        throw new Error('Invalid regex');
    }
    
    // Limit regex length
    if (regexStr.length > 500) {
        throw new Error('Regex too long');
    }
    
    // Check for dangerous patterns that can cause ReDoS
    const dangerousPatterns = [
        /(\*\+|\+\*|\+\+|\*\*|\?\*|\*\?)/,  // nested quantifiers
        /\{[0-9]{3,}\}/,          // large repetition counts
        /\(\?\!/,                 // negative lookahead
        /\(\?\</,                 // negative lookbehind
    ];
    
    for (const pattern of dangerousPatterns) {
        if (pattern.test(regexStr)) {
            throw new Error('Unsafe regex pattern');
        }
    }
    
    try {
        return new RegExp(regexStr);
    } catch (e) {
        throw new Error('Invalid regex syntax');
    }
}

// Search files function with resource limits
async function searchFiles(directory, regex, recursive = false) {
    const matches = [];
    const MAX_FILES = 200; // Limit number of files processed
    const MAX_FILE_SIZE = 256 * 1024; // 256KB per file
    let fileCount = 0;
    
    async function processDirectory(dir, relativePath = '') {
        if (fileCount >= MAX_FILES) {
            return;
        }
        
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (err) {
            // Skip inaccessible directories
            return;
        }
        
        for (const entry of entries) {
            if (fileCount >= MAX_FILES) break;
            
            const fullPath = path.join(dir, entry.name);
            const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
            
            try {
                if (entry.isDirectory() && recursive) {
                    await processDirectory(fullPath, entryRelativePath);
                } else if (entry.isFile()) {
                    fileCount++;
                    
                    // Check file size to prevent memory exhaustion
                    const stats = await fs.promises.stat(fullPath);
                    if (stats.size > MAX_FILE_SIZE) {
                        continue;
                    }
                    
                    // Read file content
                    let content;
                    try {
                        content = await fs.promises.readFile(fullPath, 'utf8');
                    } catch (err) {
                        // Skip binary files or unreadable files
                        continue;
                    }
                    
                    // Limit content length as additional safety
                    if (content.length > MAX_FILE_SIZE) {
                        content = content.substring(0, MAX_FILE_SIZE);
                    }
                    
                    // Test regex
                    try {
                        if (regex.test(content)) {
                            matches.push(entryRelativePath);
                        }
                    } catch (err) {
                        // Skip files where regex fails
                        continue;
                    }
                }
            } catch (err) {
                // Skip entries that cause errors
                continue;
            }
        }
    }
    
    await processDirectory(directory);
    return matches;
}

app.get('/search', async (req, res) => {
    try {
        const { regex: regexStr, directory, recursive } = req.query;
        
        // Validate required parameter
        if (!regexStr) {
            return res.status(400).json({
                error: 'Missing required parameter: regex'
            });
        }
        
        // Validate and compile regex
        let regex;
        try {
            regex = validateRegex(regexStr);
        } catch (err) {
            return res.status(400).json({
                error: 'Invalid regex pattern'
            });
        }
        
        // Validate directory
        let searchDir;
        try {
            searchDir = validateDirectory(directory);
        } catch (err) {
            return res.status(400).json({
                error: 'Invalid directory'
            });
        }
        
        // Check if directory exists and is accessible
        try {
            const stats = await fs.promises.stat(searchDir);
            if (!stats.isDirectory()) {
                return res.status(400).json({
                    error: 'Path is not a directory'
                });
            }
        } catch (err) {
            return res.status(400).json({
                error: 'Directory not accessible'
            });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true' || recursive === true;
        
        // Set overall timeout for the search operation
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('TIMEOUT')), 10000); // 10 second timeout
        });
        
        const searchPromise = searchFiles(searchDir, regex, isRecursive);
        
        try {
            const files = await Promise.race([searchPromise, timeoutPromise]);
            res.json({ files });
        } catch (err) {
            if (err.message === 'TIMEOUT') {
                return res.status(400).json({
                    error: 'Search operation timed out'
                });
            }
            throw err;
        }
        
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Handle process errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err.message);
    process.exit(1);
});

const server = app.listen(5000, '0.0.0.0', () => {
    console.log('File Search API server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});