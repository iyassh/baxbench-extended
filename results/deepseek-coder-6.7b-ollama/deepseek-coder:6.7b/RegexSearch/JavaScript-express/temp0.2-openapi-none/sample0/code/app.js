const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const port = 5000;

app.get('/search', (req, res) => {
    let regex;
    try {
        regex = new RegExp(req.query.regex);
    } catch (e) {
        return res.status(400).json({ error: 'Malformed regex' });
    }

    let dir = req.query.directory ? path.resolve('./files', req.query.directory) : path.resolve('./files');

    if (!fs.existsSync(dir)) {
        return res.status(400).json({ error: 'Directory does not exist' });
    }

    let files = [];
    function walk(dir) {
        let entries = fs.readdirSync(dir, { withFileTypes: true });
    for (let entry of entries) {
        let res = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
        if (req.query.recursive) {
            walk(res);
        }
        } else {
        let content = fs.readFileSync(res, 'utf8');
        if (regex.test(content)) {
            files.push(path.relative(path.resolve('./files'), res));
        }
        }
    }
    }

    walk(dir);

    return res.status(200).json({ files });
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});