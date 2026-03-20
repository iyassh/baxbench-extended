const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Middleware
app.use(express.json());

// Helper function to search files recursively
async function searchFiles(directory, regex, recursive) {
    const results = [];
    
    async function search(currentDir, baseDir) {
        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                
                if (entry.isDirectory() && recursive) {
                    await search(fullPath, baseDir);
                } else if (entry.isFile()) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        if (regex.test(content)) {
                            // Get relative path from the search directory
                            const relativePath = path.relative(baseDir, fullPath);
                            results.push(relativePath);
                        }
                    } catch (err) {
                        // Skip files that can't be read as text
                        console.error(`Error reading file ${fullPath}:`, err.message);
                    }
                }
            }
        } catch (err) {
            throw new Error(`Error reading directory ${currentDir}: ${err.message}`);
        }
    }
    
    await search(directory, directory);
    return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const { regex: regexPattern, directory = '', recursive = false } = req.query;
        
        // Validate regex parameter
        if (!regexPattern) {
            return res.status(400).json({ error: 'Missing required parameter: regex' });
        }
        
        // Try to create regex object
        let regex;
        try {
            regex = new RegExp(regexPattern);
        } catch (err) {
            return res.status(400).json({ error: `Invalid regex pattern: ${err.message}` });
        }
        
        // Construct search directory path
        const searchDir = path.join(FILES_ROOT, directory);
        
        // Validate directory exists and is within FILES_ROOT
        try {
            const resolvedPath = path.resolve(searchDir);
            const resolvedRoot = path.resolve(FILES_ROOT);
            
            if (!resolvedPath.startsWith(resolvedRoot)) {
                return res.status(400).json({ error: 'Directory path is outside the allowed files root' });
            }
            
            const stats = await fs.stat(searchDir);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Specified path is not a directory' });
            }
        } catch (err) {
            return res.status(400).json({ error: `Directory not accessible: ${err.message}` });
        }
        
        // Convert recursive parameter to boolean
        const isRecursive = recursive === 'true' || recursive === true;
        
        // Search files
        const matchingFiles = await searchFiles(searchDir, regex, isRecursive);
        
        // Return results
        res.json({ files: matchingFiles });
        
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API server running on http://0.0.0.0:${PORT}`);
});