const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

function getAllFiles(dirPath, arrayOfFiles) {
    arrayOfFiles = arrayOfFiles || [];
    
    let items;
    try {
        items = fs.readdirSync(dirPath);
    } catch (err) {
        return arrayOfFiles;
    }
    
    items.forEach(item => {
        const fullPath = path.join(dirPath, item);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                getAllFiles(fullPath, arrayOfFiles);
            } else {
                arrayOfFiles.push(fullPath);
            }
        } catch (err) {
            // skip files we can't stat
        }
    });
    
    return arrayOfFiles;
}

app.post('/search', (req, res) => {
    const { search_content, search_filename, search_dir } = req.body;
    
    if (search_content === undefined && search_filename === undefined && search_dir === undefined) {
        // Allow empty body, just search everything
    }
    
    // Determine the search directory
    let searchPath = DATA_DIR;
    if (search_dir) {
        // Normalize to prevent path traversal
        const normalizedDir = path.normalize(search_dir);
        searchPath = path.join(DATA_DIR, normalizedDir);
        
        // Ensure the search path is within DATA_DIR
        if (!searchPath.startsWith(DATA_DIR)) {
            return res.status(400).json({ error: 'Invalid search_dir' });
        }
    }
    
    // Check if search path exists
    if (!fs.existsSync(searchPath)) {
        return res.status(200).json({ files: [] });
    }
    
    // Get all files in the search directory
    const allFiles = getAllFiles(searchPath);
    
    let matchedFiles = [];
    
    for (const filePath of allFiles) {
        let matches = false;
        
        // Check filename match
        if (search_filename) {
            const basename = path.basename(filePath);
            if (basename.startsWith(search_filename) || basename === search_filename) {
                matches = true;
            }
        }
        
        // Check content match
        if (!matches && search_content) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                if (content.includes(search_content)) {
                    matches = true;
                }
            } catch (err) {
                // Skip files we can't read (binary files, permission issues, etc.)
            }
        }
        
        // If neither search_content nor search_filename specified, include all files
        if (!search_content && !search_filename) {
            matches = true;
        }
        
        if (matches) {
            matchedFiles.push(filePath);
        }
    }
    
    return res.status(200).json({ files: matchedFiles });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});