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

// Request timeout middleware to prevent resource exhaustion
app.use((req, res, next) => {
    req.setTimeout(30000); // 30 second timeout
    res.setTimeout(30000);
    next();
});

// Helper function to safely resolve and validate paths
function safeResolvePath(basePath, userPath) {
    const normalizedBase = path.resolve(basePath);
    const resolved = path.resolve(basePath, userPath || '');
    
    // Ensure the resolved path is within the base directory
    if (!resolved.startsWith(normalizedBase)) {
        throw new Error('Invalid directory path');
    }
    
    return resolved;
}

// Recursive file search with depth limit
async function searchFiles(dir, regex, recursive, currentDepth = 0, maxDepth = 10) {
    const results = [];
    
    // Prevent excessive recursion
    if (currentDepth > maxDepth) {
        return results;
    }
    
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        // Limit number of files to process to prevent resource exhaustion
        const maxFiles = 1000;
        let filesProcessed = 0;
        
        for (const entry of entries) {
            if (filesProcessed >= maxFiles) {
                break;
            }
            
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && recursive) {
                const subResults = await searchFiles(fullPath, regex, recursive, currentDepth + 1, maxDepth);
                results.push(...subResults);
            } else if (entry.isFile()) {
                filesProcessed++;
                
                try {
                    // Limit file size to prevent memory exhaustion
                    const stats = await fs.stat(fullPath);
                    const maxFileSize = 10 * 1024 * 1024; // 10MB
                    
                    if (stats.size > maxFileSize) {
                        continue;
                    }
                    
                    const content = await fs.readFile(fullPath, 'utf8');
                    
                    if (regex.test(content)) {
                        results.push(fullPath);
                    }
                } catch (err) {
                    // Skip files that can't be read as text
                    continue;
                }
            }
        }
    } catch (err) {
        // Handle directory access errors gracefully
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            // Skip directories we can't access
            return results;
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
        
        // Validate and compile regex with timeout
        let regex;
        try {
            // Limit regex complexity by checking length
            if (regexPattern.length > 1000) {
                return res.status(400).json({ error: 'Regex pattern too long' });
            }
            
            regex = new RegExp(regexPattern);
            
            // Test regex with empty string to catch catastrophic backtracking early
            const testTimeout = setTimeout(() => {
                throw new Error('Regex execution timeout');
            }, 100);
            
            regex.test('');
            clearTimeout(testTimeout);
            
        } catch (err) {
            return res.status(400).json({ error: 'Invalid regex pattern' });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true';
        
        // Resolve and validate search directory
        let searchDir;
        try {
            searchDir = safeResolvePath(FILES_ROOT, directory || '');
        } catch (err) {
            return res.status(400).json({ error: 'Invalid directory path' });
        }
        
        // Check if directory exists and is accessible
        try {
            const stats = await fs.stat(searchDir);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                return res.status(400).json({ error: 'Directory does not exist' });
            } else if (err.code === 'EACCES' || err.code === 'EPERM') {
                return res.status(400).json({ error: 'Directory is not accessible' });
            }
            throw err;
        }
        
        // Perform search
        const matchedFiles = await searchFiles(searchDir, regex, isRecursive);
        
        // Convert absolute paths to relative paths
        const relativePaths = matchedFiles.map(filePath => {
            return path.relative(searchDir, filePath);
        });
        
        res.json({ files: relativePaths });
        
    } catch (err) {
        // Log error internally but don't expose details to client
        console.error('Search error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    // Log error internally but don't expose details to client
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});