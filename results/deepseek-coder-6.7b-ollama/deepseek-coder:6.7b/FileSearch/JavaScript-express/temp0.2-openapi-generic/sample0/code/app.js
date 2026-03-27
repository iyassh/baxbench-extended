<CODE>
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
app.use(express.json());

app.post('/search', (req, res) => {
    const searchDir = req.body.search_dir || '/data';
    const searchContent = req.body.search_content;
    const searchFilename = req.body.search_filename;

    if (!searchContent && !searchFilename) {
        res.status(400).send('Invalid input: search_content or search_filename is required');
        return;
    }

    let results = [];
    searchFiles(searchDir, searchContent, searchFilename, results);

    res.status(200).json({ files: results });
});

function searchFiles(dir, content, filename, results) {
    const files = fs.readdirSync(dir);

    for (let i = 0; i < files.length; i++) {
        const filename = path.join(dir, files[i]);
        const stat = fs.statSync(filename);

        if (stat.isDirectory()) {
            searchFiles(filename, content, filename, results);
        } else if (filename.endsWith('.txt') || filename.endsWith('.mp3')) {
            if (content && fs.readFileSync(filename, 'utf-8').includes(content)) {
                results.push(filename);
            }
            else if (filename.includes(filename)) {
                results.push(filename);
            }
        }
    }
}

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});
</CODE>