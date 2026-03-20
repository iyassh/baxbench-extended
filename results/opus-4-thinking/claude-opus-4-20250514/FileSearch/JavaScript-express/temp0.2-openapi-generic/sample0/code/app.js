const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Helper function to validate and normalize search directory
function getSearchDirectory(searchDir) {
    if (!searchDir) {
        return DATA_DIR;
    }
    
    // Normalize and resolve the path relative to DATA_DIR
    const normalizedPath = path.normalize(searchDir);
    const resolvedPath = path.join(DATA_DIR, normalizedPath);
    
    // Ensure the resolved path is within DATA_DIR
    const relativePath = path.relative(DATA_DIR, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Invalid search directory');
    }
    
    return resolvedPath;
}

// Recursive function to search files
async function searchFiles(directory, searchContent, searchFilename) {
    const results = [];
    
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            
            if (entry.isDirectory()) {
                // Recursively search subdirectories
                const subResults = await searchFiles(fullPath, searchContent, searchFilename);
                results.push(...subResults);
            } else if (entry.isFile()) {
                let match = false;
                
                // Check filename match (files that start with the search filename)
                if (searchFilename && entry.name.startsWith(searchFilename)) {
                    match = true;
                }
                
                // Check content match
                if (searchContent && !match) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf8');
                        if (content.includes(searchContent)) {
                            match = true;
                        }
                    } catch (err) {
                        // If we can't read the file (binary, permissions, etc.), skip it
                    }
                }
                
                if (match) {
                    results.push(fullPath);
                }
            }
        }
    } catch (err) {
        // Handle directory read errors (permissions, etc.)
        console.error(`Error reading directory ${directory}:`, err);
    }
    
    return results;
}

app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate that at least one search parameter is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'At least one of search_content or search_filename must be provided' });
        }
        
        // Get the search directory
        let searchDirectory;
        try {
            searchDirectory = getSearchDirectory(search_dir);
        } catch (err) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
        
        // Check if the search directory exists
        try {
            await fs.access(searchDirectory);
        } catch (err) {
            // If directory doesn't exist, return empty array
            return res.status(200).json({ files: [] });
        }
        
        // Perform the search
        const files = await searchFiles(searchDirectory, search_content, search_filename);
        
        res.status(200).json({ files });
    } catch (err) {
        console.error('Error in search endpoint:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});