const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const FILES_ROOT = path.resolve('./files');

// Function to search files recursively or non-recursively
function searchFiles(dirPath, regex, recursive) {
    const matchingFiles = [];
    
    function searchDirectory(currentPath, relativePath = '') {
        try {
            const items = fs.readdirSync(currentPath);
            
            for (const item of items) {
                const fullPath = path.join(currentPath, item);
                const relativeItemPath = relativePath ? path.join(relativePath, item) : item;
                
                const stats = fs.statSync(fullPath);
                
                if (stats.isFile()) {
                    // Read file content and test against regex
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        if (regex.test(content)) {
                            // Normalize path separators to forward slashes for consistency
                            matchingFiles.push(relativeItemPath.replace(/\\/g, '/'));
                        }
                    } catch (error) {
                        // Skip files that can't be read (binary files, permission issues, etc.)
                        continue;
                    }
                } else if (stats.isDirectory() && recursive) {
                    searchDirectory(fullPath, relativeItemPath);
                }
            }
        } catch (error) {
            throw error;
        }
    }
    
    searchDirectory(dirPath);
    return matchingFiles;
}

app.get('/search', (req, res) => {
    try {
        const { regex: regexPattern, directory = '', recursive = false } = req.query;
        
        // Validate regex parameter
        if (!regexPattern) {
            return res.status(400).json({ error: 'regex parameter is required' });
        }
        
        // Create regex object
        let regex;
        try {
            regex = new RegExp(regexPattern);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid regex pattern' });
        }
        
        // Determine search directory - ensure it's within FILES_ROOT
        let searchDir;
        try {
            if (directory) {
                searchDir = path.resolve(path.join(FILES_ROOT, directory));
            } else {
                searchDir = FILES_ROOT;
            }
            
            // Security check: ensure the resolved path is within or exactly FILES_ROOT
            const normalizedFilesRoot = path.resolve(FILES_ROOT);
            if (searchDir !== normalizedFilesRoot && !searchDir.startsWith(normalizedFilesRoot + path.sep)) {
                return res.status(400).json({ error: 'Directory path is not allowed' });
            }
        } catch (error) {
            return res.status(400).json({ error: 'Invalid directory path' });
        }
        
        // Check if directory exists and is accessible
        try {
            if (!fs.existsSync(searchDir)) {
                return res.status(400).json({ error: 'Directory does not exist' });
            }
            
            const stats = fs.statSync(searchDir);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (error) {
            return res.status(400).json({ error: 'Directory is not accessible' });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true' || recursive === true;
        
        // Search files
        const matchingFiles = searchFiles(searchDir, regex, isRecursive);
        
        res.json({ files: matchingFiles });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on 0.0.0.0:5000');
});