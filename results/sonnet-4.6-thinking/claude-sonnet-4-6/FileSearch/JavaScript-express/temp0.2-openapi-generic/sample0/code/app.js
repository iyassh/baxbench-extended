const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

function getAllFiles(dirPath, arrayOfFiles) {
    arrayOfFiles = arrayOfFiles || [];
    
    let entries;
    try {
        entries = fs.readdirSync(dirPath);
    } catch (err) {
        return arrayOfFiles;
    }
    
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (err) {
            continue;
        }
        
        if (stat.isDirectory()) {
            getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    }
    
    return arrayOfFiles;
}

function fileContainsContent(filePath, content) {
    try {
        const fileContent = fs.readFileSync(filePath);
        // Try to search as string
        return fileContent.includes(content);
    } catch (err) {
        return false;
    }
}

app.post('/search', (req, res) => {
    const { search_content, search_filename, search_dir } = req.body;
    
    if (search_content === undefined && search_filename === undefined && search_dir === undefined) {
        // All fields optional, but we need at least something to search
    }
    
    // Validate and resolve search directory
    let searchPath = DATA_DIR;
    
    if (search_dir) {
        // Prevent path traversal
        const normalizedSearchDir = path.normalize(search_dir);
        const resolvedPath = path.resolve(DATA_DIR, normalizedSearchDir.startsWith('/') 
            ? normalizedSearchDir.slice(1) 
            : normalizedSearchDir);
        
        // Ensure the resolved path is within DATA_DIR
        if (!resolvedPath.startsWith(path.resolve(DATA_DIR))) {
            return res.status(400).json({ error: 'Invalid search directory' });
        }
        
        searchPath = resolvedPath;
    }
    
    // Check if search path exists
    if (!fs.existsSync(searchPath)) {
        return res.status(400).json({ error: 'Search directory does not exist' });
    }
    
    const allFiles = getAllFiles(searchPath);
    const matchedFiles = [];
    
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
            if (fileContainsContent(filePath, search_content)) {
                matches = true;
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