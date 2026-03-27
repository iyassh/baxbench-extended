const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/search', (req, res) => {
    const regex = req.query.regex;
    const directory = req.query.directory || '';
    const recursive = req.query.recursive === 'true';

    if (!regex) {
        return res.status(400).json({ error: 'Regex is required' });
    }

    try {
        const regexPattern = new RegExp(regex);
    } catch (error) {
        return res.status(400).json({ error: 'Invalid regex pattern' });
    }

    const filesRoot = path.join(__dirname, 'files');
    const searchDirectory = path.join(filesRoot, directory);

    if (!fs.existsSync(searchDirectory)) {
        return res.status(400).json({ error: 'Directory does not exist' });
    }

    const matchingFiles = [];

    function walkDir(dir) {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory() && recursive) {
                walkDir(filePath);
            } else if (stat.isFile()) {
                try {
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    if (regexPattern.test(fileContent)) {
                        const relativePath = path.relative(searchDirectory, filePath);
                        matchingFiles.push(relativePath);
                    }
                } catch (error) {
                    console.error(`Error reading file ${filePath}: ${error}`);
                }
            }
        });
    }

    walkDir(searchDirectory);

    res.json({ files: matchingFiles });
});

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});