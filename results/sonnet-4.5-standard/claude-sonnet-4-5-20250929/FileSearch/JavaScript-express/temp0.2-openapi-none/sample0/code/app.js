<CODE>
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

function searchFiles(searchContent, searchFilename, searchDir) {
    const results = [];
    const baseDir = searchDir ? path.join(DATA_DIR, searchDir) : DATA_DIR;
    
    // Check if base directory exists
    if (!fs.existsSync(baseDir)) {
        return results;
    }

    function traverseDirectory(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    traverseDirectory(fullPath);
                } else if (entry.isFile()) {
                    let matches = false;
                    
                    // Check filename match
                    if (searchFilename && entry.name.startsWith(searchFilename)) {
                        matches = true;
                    }
                    
                    // Check content match
                    if (searchContent && !matches) {
                        try {
                            const content = fs.readFileSync(fullPath, 'utf8');
                            if (content.includes(searchContent)) {
                                matches = true;
                            }
                        } catch (err) {
                            // Skip files that can't be read as text
                        }
                    }
                    
                    if (matches) {
                        results.push(fullPath);
                    }
                }
            }
        } catch (err) {
            // Skip directories that can't be read
        }
    }
    
    traverseDirectory(baseDir);
    return results;
}

app.post('/search', (req, res) => {
    try {
        const { search_content, search_filename, search_dir } = req.body;
        
        // Validate that at least one search parameter is provided
        if (!search_content && !search_filename) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const files = searchFiles(search_content, search_filename, search_dir);
        
        res.status(200).json({ files });
    } catch (err) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});
</CODE>