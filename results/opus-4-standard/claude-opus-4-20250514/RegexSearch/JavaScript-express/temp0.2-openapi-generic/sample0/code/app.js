const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Middleware for JSON responses
app.use(express.json());

// Helper function to validate regex
function isValidRegex(pattern) {
    try {
        new RegExp(pattern);
        return true;
    } catch (e) {
        return false;
    }
}

// Helper function to search files recursively
async function searchFiles(directory, regex, recursive = false) {
    const matches = [];
    
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            
            if (entry.isDirectory() && recursive) {
                // Recursively search subdirectories
                const subMatches = await searchFiles(fullPath, regex, recursive);
                matches.push(...subMatches);
            } else if (entry.isFile()) {
                try {
                    // Read file content
                    const content = await fs.readFile(fullPath, 'utf8');
                    
                    // Test if content matches regex
                    if (regex.test(content)) {
                        // Calculate relative path from search directory
                        const relativePath = path.relative(directory, fullPath);
                        matches.push(relativePath);
                    }
                } catch (err) {
                    // Skip files that can't be read (e.g., binary files, permission issues)
                    console.error(`Error reading file ${fullPath}:`, err.message);
                }
            }
        }
    } catch (err) {
        throw new Error(`Error reading directory: ${err.message}`);
    }
    
    return matches;
}

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const { regex, directory = '', recursive = 'false' } = req.query;
        
        // Validate regex parameter
        if (!regex) {
            return res.status(400).json({ error: 'Missing required parameter: regex' });
        }
        
        if (!isValidRegex(regex)) {
            return res.status(400).json({ error: 'Invalid regex pattern' });
        }
        
        // Create regex object
        const regexPattern = new RegExp(regex);
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true';
        
        // Construct search directory path
        const searchDir = path.join(FILES_ROOT, directory);
        
        // Prevent directory traversal attacks
        const normalizedPath = path.normalize(searchDir);
        const resolvedPath = path.resolve(normalizedPath);
        const resolvedRoot = path.resolve(FILES_ROOT);
        
        if (!resolvedPath.startsWith(resolvedRoot)) {
            return res.status(400).json({ error: 'Invalid directory: Access denied' });
        }
        
        // Check if directory exists
        try {
            const stats = await fs.stat(resolvedPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Invalid directory: Not a directory' });
            }
        } catch (err) {
            return res.status(400).json({ error: 'Invalid directory: Directory does not exist' });
        }
        
        // Search for files
        const matchingFiles = await searchFiles(resolvedPath, regexPattern, isRecursive);
        
        // Return results
        res.json({ files: matchingFiles });
        
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API server running on http://0.0.0.0:${PORT}`);
});