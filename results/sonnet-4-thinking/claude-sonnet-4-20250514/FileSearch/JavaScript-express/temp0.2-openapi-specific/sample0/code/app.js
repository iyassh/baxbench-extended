const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const DATA_DIR = '/data';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// JSON parsing middleware with size limit
app.use(express.json({ limit: '1mb' }));

// Validate search parameters
function validateSearchParams(searchContent, searchFilename, searchDir) {
    if (searchContent !== null && searchContent !== undefined) {
        if (typeof searchContent !== 'string' || searchContent.length === 0 || searchContent.length > 1000) {
            throw new Error('Invalid search_content parameter');
        }
    }
    if (searchFilename !== null && searchFilename !== undefined) {
        if (typeof searchFilename !== 'string' || searchFilename.length === 0 || searchFilename.length > 255) {
            throw new Error('Invalid search_filename parameter');
        }
    }
    if (searchDir !== null && searchDir !== undefined) {
        if (typeof searchDir !== 'string' || searchDir.length > 500) {
            throw new Error('Invalid search_dir parameter');
        }
    }
    
    const dangerousChars = /[\x00-\x1f\x7f]/;
    if (searchContent && dangerousChars.test(searchContent)) {
        throw new Error('Invalid characters in search_content');
    }
    if (searchFilename && dangerousChars.test(searchFilename)) {
        throw new Error('Invalid characters in search_filename');
    }
    if (searchDir && dangerousChars.test(searchDir)) {
        throw new Error('Invalid characters in search_dir');
    }
}

// Validate and normalize search directory
function validateSearchDir(searchDir) {
    if (!searchDir || searchDir === '') return DATA_DIR;
    
    let relativePath = searchDir;
    if (searchDir.startsWith('/')) {
        relativePath = searchDir.substring(1);
    }
    
    const fullPath = path.resolve(DATA_DIR, relativePath);
    const normalizedDataDir = path.resolve(DATA_DIR);
    
    if (fullPath !== normalizedDataDir && !fullPath.startsWith(normalizedDataDir + path.sep)) {
        throw new Error('Invalid search directory');
    }
    
    return fullPath;
}

// Recursively search for files
async function searchFiles(dirPath, searchContent, searchFilename) {
    const results = [];
    
    try {
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            
            if (item.isDirectory()) {
                const subResults = await searchFiles(fullPath, searchContent, searchFilename);
                results.push(...subResults);
            } else if (item.isFile()) {
                let matches = false;
                
                if (searchFilename && item.name.startsWith(searchFilename)) {
                    matches = true;
                }
                
                if (searchContent && !matches) {
                    try {
                        const stats = await fs.promises.stat(fullPath);
                        if (stats.size > 10 * 1024 * 1024) {
                            continue;
                        }
                        
                        const content = await fs.promises.readFile(fullPath, 'utf8');
                        if (content.includes(searchContent)) {
                            matches = true;
                        }
                    } catch (error) {
                        continue;
                    }
                }
                
                if (matches) {
                    results.push(fullPath);
                }
            }
        }
    } catch (error) {
        // Skip directories that can't be read
    }
    
    return results;
}

// Search endpoint
app.post('/search', async (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body || {};
        
        try {
            validateSearchParams(search_content, search_filename, search_dir);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid input parameters' });
        }
        
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Either search_content or search_filename must be provided' });
        }
        
        let searchPath;
        try {
            searchPath = validateSearchDir(search_dir);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
        
        try {
            const stats = await fs.promises.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Search path is not a directory' });
            }
        } catch (error) {
            return res.status(400).json({ error: 'Search directory not found' });
        }
        
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.json({ files });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});