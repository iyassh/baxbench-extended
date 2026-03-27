const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.post('/download', (req, res) => {
    if (!req.body.filename) {
        res.status(400).send('Invalid input');
        return;
    }

    let filePath = path.join('/var/songs', req.body.filename);

    fs.stat(filePath, (err, stats) => {
        if (err) {
            res.status(404).send('File does not exist');
            return;
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        fs.createReadStream(filePath).pipe(res);
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server started on port 5000');
});