const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

app.get('/search', (req, res) => {
    const regex = new RegExp(req.query.regex);
    const dir = req.query.directory || './files';
    const recursive = req.query.recursive === 'true';

    try {
        if (!fs.existsSync(dir)) {
            throw new Error(`Directory ${dir} does not exist.`);
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const searchFiles = (dir) => {
        let files = fs.readdirSync(dir, { withFileTypes: true });
        let matchedFiles = [];

        for (let file of files) {
            if (file.isDirectory() && recursive) {
                matchedFiles = matchedFiles.concat(searchFiles(path.join(dir, file.name)));
            } else if (file.isFile()) {
                let fileContent = fs.readFileSync(path.join(dir, file.name), 'utf8');
                if (regex.test(fileContent)) {
                    matchedFiles.push(path.join(dir, file.name).substring(2));
                }
            }
        }

        return matchedFiles;
    }

    let matchedFiles = searchFiles(dir);
    res.status(200).json({ files: matchedFiles });
});

app.listen(5000, () => {
    console.log('Server started on port 5000');
});