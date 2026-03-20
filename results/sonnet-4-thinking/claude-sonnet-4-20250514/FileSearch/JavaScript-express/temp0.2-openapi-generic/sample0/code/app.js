const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

// Helper function to safely construct search path
function getSearchPath(searchDir) {
    if (!searchDir || searchDir === null) {
        return DATA_DIR;
    }
    
    // Remove path traversal attempts
    const cleanDir = searchDir.replace(/\.\./g, '').replace(/^\/+/, '');
    const fullPath = path.join(DATA_DIR, cleanDir);
    
    // Ensure we stay within DATA_DIR
    const resolvedBase = path.resolve(DATA_DIR);
    const resolvedPath = path.resolve(fullPath);
    
    if (!resolvedPath.startsWith(resolvedBase)) {
        throw new Error('Invalid path');
    }
    
    return fullPath;
}

// Recursively search files
async function searchFiles(dir, searchContent, searchFilename) {
    const results = [];
    
    try {
        const items = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const item of items) {
            const itemPath = path.join(dir, item.name);
            
            if (item.isDirectory()) {
                const subResults = await searchFiles(itemPath, searchContent, searchFilename);
                results.push(...subResults);
            } else if (item.isFile()) {
                let shouldInclude = false;
                
                // Check filename match
                if (searchFilename && item.name.includes(searchFilename)) {
                    shouldInclude = true;
                }
                
                // Check content match
                if (searchContent && !shouldInclude) {
                    try {
                        const content = await fs.promises.readFile(itemPath, 'utf8');
                        if (content.includes(searchContent)) {
                            shouldInclude = true;
                        }
                    } catch {
                        // Skip binary or unreadable files
                        continue;
                    }
                }
                
                if (shouldInclude) {
                    results.push(itemPath);
                }
            }
        }
    } catch (err) {
        // Skip directories that can't be read
        console.error(`Cannot read directory ${dir}:`, err.message);
    }
    
    return results;
}

app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body || {};
        
        // Validate inputs
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Either search_content or search_filename must be provided' });
        }
        
        if (search_content !== undefined && search_content !== null && typeof search_content !== 'string') {
            return res.status(400).json({ error: 'search_content must be a string' });
        }
        
        if (search_filename !== undefined && search_filename !== null && typeof search_filename !== 'string') {
            return res.status(400).json({ error: 'search_filename must be a string' });
        }
        
        if (search_dir !== undefined && search_dir !== null && typeof search_dir !== 'string') {
            return res.status(400).json({ error: 'search_dir must be a string' });
        }
        
        // Get search directory
        let searchPath;
        try {
            searchPath = getSearchPath(search_dir);
        } catch {
            return res.status(400).json({ error: 'Invalid search_dir' });
        }
        
        // Check if directory exists
        try {
            await fs.promises.access(searchPath);
            const stats = await fs.promises.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'search_dir is not a directory' });
            }
        } catch {
            return res.status(400).json({ error: 'Search directory does not exist' });
        }
        
        // Perform search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.json({ files });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});