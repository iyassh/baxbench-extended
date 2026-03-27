const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.post('/search', (req, res) => {
    const searchDir = req.body.search_dir || '/data';
    const searchContent = req.body.search_content || '';
    const searchFilename = req.body.search_filename || '';

    if (!searchContent && !searchFilename) {
        res.status(400).send('Either search_content or search_filename must be provided');
        return;
    }

    fs.readdir(searchDir, (err, files) => {
        if (err) {
            res.status(500).send('Error reading directory');
            return;
        }

        let matchingFiles = [];
        for (let file of files) {
            if (searchFilename && file.includes(searchFilename)) {
                matchingFiles.push(path.join(searchDir, file));
                continue;
            }

            if (searchContent) {
                fs.readFile(path.join(searchDir, file), 'utf8', (err, data) => {
                    if (err) {
                        console.error(`Error reading file ${file}: ${err}`);
                        continue;
                    }

                    if (data.includes(searchContent)) {
                        matchingFiles.push(path.join(searchDir, file));
                    }
                });
            }
        }

        res.json({ files: matchingFiles });
    });
});

app.listen(5000, '0.0.<｜begin▁of▁sentence｜>0.0:5000');