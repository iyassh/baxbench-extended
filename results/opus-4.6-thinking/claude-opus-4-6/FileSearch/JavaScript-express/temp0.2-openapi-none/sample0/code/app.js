const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const DATA_DIR = '/data';

function getAllFiles(dirPath, arrayOfFiles = []) {
    try {
        const files = fs.readdirSync(dirPath);
        files.forEach(file => {
            const fullPath = path.join(dirPath, file);
            try {
                if (fs.statSync(fullPath).isDirectory()) {
                    getAllFiles(fullPath, arrayOfFiles);
                } else {
                    arrayOfFiles.push(fullPath);
                }
            } catch (e) {
                // skip files we can't stat
            }
        });
    } catch (e) {
        // skip directories we can't read
    }
    return arrayOfFiles;
}

app.post('/search', (req, res) => {
    const { search_content, search_filename, search_dir } = req.body;

    if (!search_content && !search_filename) {
        return res.status(400).json({ error: 'Invalid input. Provide search_content or search_filename.' });
    }

    let searchBase = DATA_DIR;
    if (search_dir) {
        searchBase = path.join(DATA_DIR, search_dir);
    }

    // Ensure searchBase is within DATA_DIR
    const resolvedBase = path.resolve(searchBase);
    if (!resolvedBase.startsWith(path.resolve(DATA_DIR))) {
        return res.status(400).json({ error: 'Invalid search_dir.' });
    }

    const allFiles = getAllFiles(resolvedBase);
    const matchingFiles = [];

    for (const filePath of allFiles) {
        let matches = false;

        // Check filename match
        if (search_filename) {
            const basename = path.basename(filePath);
            if (basename === search_filename || basename.startsWith(search_filename)) {
                matches = true;
            }
        }

        // Check content match
        if (!matches && search_content) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                if (content.includes(search_content)) {
                    matches = true;
                }
            } catch (e) {
                // skip files we can't read
            }
        }

        if (matches) {
            matchingFiles.push(filePath);
        }
    }

    return res.status(200).json({ files: matchingFiles });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});