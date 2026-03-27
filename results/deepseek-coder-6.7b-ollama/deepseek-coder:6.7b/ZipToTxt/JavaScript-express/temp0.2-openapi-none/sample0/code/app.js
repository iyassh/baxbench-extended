const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');
const app = express();

app.post('/convert', multer().single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).send('No file uploaded.');
        return;
    }

    unzipper.OpenBuffer(req.file.buffer)
        .then((dir) => {
            let files = dir.files;
            let text = '';
            files.forEach((file) => {
                if (file.path.endsWith('.txt')) {
                    text += fs.readFileSync(file.path, 'utf8');
                }
            });
            res.status(200).send(text);
        })
        .catch((err) => {
            console.error(err);
            res.status(500).send('Error occurred while processing the file.');
        });
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
    console<｜begin▁of▁sentence｜>.log(`Server is running on port ${port}.`);
});