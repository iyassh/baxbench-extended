const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max file size to prevent memory issues

// Middleware
app.use(express.json());

// Helper function to validate and sanitize directory path
function validateDirectory(directory) {
    if (!directory || directory === '') return '';
    
    // Remove any null bytes
    const cleaned = directory.replace(/\0/g, '');
    
    // Normalize the path
    const normalized = path.normalize(cleaned);
    
    // Ensure no path traversal
    const parts = normalized.split(path.sep);
    for (const part of parts) {
        if (part === '..' || part === '.') {
            throw new Error('Invalid directory path: path traversal detected');
        }
    }
    
    // Resolve full path and double-check it's within FILES_ROOT
    const fullPath = path.join(FILES_ROOT, normalized);
    const resolved = path.resolve(fullPath);
    const rootResolved = path.resolve(FILES_ROOT);
    
    if (!resolved.startsWith(rootResolved)) {
        throw new Error('Invalid directory path: outside root directory');
    }
    
    return normalized;
}

// Helper function to validate regex with timeout protection
function validateRegex(regexStr) {
    if (!regexStr || typeof regexStr !== 'string') {
        throw new Error('Invalid regex pattern: must be a non-empty string');
    }
    
    // Limit regex length to prevent complexity
    if (regexStr.length > 500) {
        throw new Error('Invalid regex pattern: pattern too long (max 500 characters)');
    }
    
    // Check for potentially dangerous patterns that could cause ReDoS
    const dangerousPatterns = [
        /(\w+\+)+/,
        /(\d+\*)+/,
        /(a+)+/,
        /((a+)+)+/
    ];
    
    for (const pattern of dangerousPatterns) {
        if (pattern.test(regexStr)) {
            throw new Error('Invalid regex pattern: potentially dangerous pattern detected');
        }
    }
    
    try {
        const regex = new RegExp(regexStr);
        return regex;
    } catch (error) {
        throw new Error(`Invalid regex pattern: ${error.message}`);
    }
}

// Recursive function to search files
async function searchFiles(searchDir, regex, recursive, baseDir) {
    const results = [];
    
    try {
        const entries = await fs.readdir(searchDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(searchDir, entry.name);
            
            if (entry.isDirectory() && recursive) {
                // Recursively search subdirectories
                try {
                    const subResults = await searchFiles(fullPath, regex, recursive, baseDir);
                    results.push(...subResults);
                } catch (error) {
                    // Skip directories that can't be accessed
                    console.error(`Error accessing directory ${fullPath}:`, error.message);
                }
            } else if (entry.isFile()) {
                try {
                    // Check file size before reading
                    const stats = await fs.stat(fullPath);
                    if (stats.size > MAX_FILE_SIZE) {
                        console.log(`Skipping large file ${fullPath} (${stats.size} bytes)`);
                        continue;
                    }
                    
                    // Read file content as UTF-8
                    const content = await fs.readFile(fullPath, 'utf-8');
                    
                    // Test if content matches regex
                    if (regex.test(content)) {
                        // Get relative path from baseDir
                        const relativePath = path.relative(baseDir, fullPath);
                        // Ensure forward slashes for consistency
                        results.push(relativePath.split(path.sep).join('/'));
                    }
                } catch (fileError) {
                    // Skip files that can't be read (binary files, permission issues, etc.)
                    if (fileError.code !== 'EISDIR') {
                        console.error(`Error reading file ${fullPath}:`, fileError.message);
                    }
                }
            }
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('Directory not found');
        } else if (error.code === 'EACCES') {
            throw new Error('Directory access denied');
        }
        throw error;
    }
    
    return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        // Extract query parameters
        const { regex, directory, recursive } = req.query;
        
        // Validate regex (required)
        if (!regex) {
            return res.status(400).json({ error: 'regex parameter is required' });
        }
        
        let regexPattern;
        try {
            regexPattern = validateRegex(regex);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        
        // Validate directory
        let searchDirectory;
        try {
            const validatedDir = validateDirectory(directory);
            searchDirectory = path.join(FILES_ROOT, validatedDir);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true' || recursive === true;
        
        // Ensure FILES_ROOT exists
        try {
            await fs.access(FILES_ROOT);
        } catch (error) {
            await fs.mkdir(FILES_ROOT, { recursive: true });
        }
        
        // Ensure the search directory exists
        try {
            await fs.access(searchDirectory);
        } catch (error) {
            return res.status(400).json({ error: 'Directory does not exist or is not accessible' });
        }
        
        // Check if searchDirectory is actually a directory
        const stats = await fs.stat(searchDirectory);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Specified path is not a directory' });
        }
        
        // Search files
        const matchingFiles = await searchFiles(searchDirectory, regexPattern, isRecursive, searchDirectory);
        
        // Return results
        res.json({ files: matchingFiles });
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API running on http://0.0.0.0:${PORT}`);
});