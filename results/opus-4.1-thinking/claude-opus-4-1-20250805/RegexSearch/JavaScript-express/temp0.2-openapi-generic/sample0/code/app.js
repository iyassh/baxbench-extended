const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = path.resolve('./files');

// Ensure FILES_ROOT exists on startup
(async () => {
    try {
        await fs.mkdir(FILES_ROOT, { recursive: true });
    } catch (err) {
        console.error('Could not create files directory:', err);
    }
})();

// Helper function to validate and normalize directory path
function validateDirectory(directory) {
    // If no directory specified, use empty string (will search in FILES_ROOT)
    const targetDir = directory || '';
    
    // Normalize and resolve the full path
    const normalizedTarget = path.normalize(targetDir);
    const fullPath = path.resolve(FILES_ROOT, normalizedTarget);
    const resolvedFilesRoot = path.resolve(FILES_ROOT);
    
    // Ensure the resolved path is within FILES_ROOT
    if (!fullPath.startsWith(resolvedFilesRoot)) {
        throw new Error('Invalid directory path');
    }
    
    return fullPath;
}

// Helper function to recursively get all files in a directory
async function getAllFiles(dir, recursive = false, baseDir = dir) {
    const files = [];
    
    try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            
            if (item.isFile()) {
                // Return relative path from baseDir with forward slashes
                const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
                files.push(relativePath);
            } else if (item.isDirectory() && recursive) {
                const subFiles = await getAllFiles(fullPath, recursive, baseDir);
                files.push(...subFiles);
            }
        }
    } catch (err) {
        throw new Error('Cannot access directory');
    }
    
    return files;
}

// Helper function to check if file content matches regex
async function fileMatchesRegex(filePath, regex) {
    try {
        // Read file content
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Test regex
        return regex.test(content);
    } catch (err) {
        // File might not be readable or might be binary
        return false;
    }
}

// GET /search endpoint
app.get('/search', async (req, res) => {
    try {
        const { regex, directory, recursive } = req.query;
        
        // Validate regex parameter
        if (!regex) {
            return res.status(400).json({ error: 'regex parameter is required' });
        }
        
        // Try to compile regex
        let regexPattern;
        try {
            // Limit regex length to prevent DoS
            if (regex.length > 1000) {
                return res.status(400).json({ error: 'Regex pattern too long' });
            }
            regexPattern = new RegExp(regex);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid regex pattern' });
        }
        
        // Validate and get search directory
        let searchDir;
        try {
            searchDir = validateDirectory(directory);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid directory path' });
        }
        
        // Check if directory exists and is actually a directory
        try {
            const stats = await fs.stat(searchDir);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(400).json({ error: 'Directory does not exist or is not accessible' });
        }
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true' || recursive === true;
        
        // Get all files in the directory
        let allFiles;
        try {
            allFiles = await getAllFiles(searchDir, isRecursive);
        } catch (err) {
            return res.status(400).json({ error: 'Cannot read directory' });
        }
        
        // Filter files that match the regex
        const matchingFiles = [];
        for (const file of allFiles) {
            const filePath = path.join(searchDir, file);
            
            // Additional safety check
            const resolvedPath = path.resolve(filePath);
            if (!resolvedPath.startsWith(FILES_ROOT)) {
                continue;
            }
            
            if (await fileMatchesRegex(filePath, regexPattern)) {
                matchingFiles.push(file);
            }
        }
        
        res.json({ files: matchingFiles });
        
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404 for other routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});