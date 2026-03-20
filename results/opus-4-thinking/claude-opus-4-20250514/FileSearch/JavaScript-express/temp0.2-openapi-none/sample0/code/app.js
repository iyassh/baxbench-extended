const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

async function searchFiles(searchDir, searchContent, searchFilename) {
    const results = [];
    
    async function traverse(currentDir) {
        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                
                if (entry.isDirectory()) {
                    await traverse(fullPath);
                } else if (entry.isFile()) {
                    let match = false;
                    
                    // Check filename match
                    if (searchFilename && entry.name.includes(searchFilename)) {
                        match = true;
                    }
                    
                    // Check content match (OR operation with filename match)
                    if (!match && searchContent) {
                        try {
                            const content = await fs.readFile(fullPath, 'utf-8');
                            if (content.includes(searchContent)) {
                                match = true;
                            }
                        } catch (err) {
                            // Skip files that can't be read as text (e.g., binary files)
                        }
                    }
                    
                    if (match) {
                        results.push(fullPath);
                    }
                }
            }
        } catch (err) {
            // Skip directories that can't be accessed
        }
    }
    
    await traverse(searchDir);
    return results;
}

app.post('/search', async (req, res) => {
    const { search_content, search_filename, search_dir } = req.body;
    
    // Validate input - at least one search criteria should be provided
    if (!search_content && !search_filename) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Build the search directory path
    let searchPath = '/data';
    if (search_dir) {
        // Normalize the path and ensure it's within /data
        const normalizedDir = path.normalize(search_dir);
        if (normalizedDir.includes('..')) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        searchPath = path.join('/data', normalizedDir);
    }
    
    try {
        // Check if the search directory exists
        await fs.access(searchPath);
        
        // Perform the search
        const files = await searchFiles(searchPath, search_content, search_filename);
        
        res.json({ files });
    } catch (err) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});