const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: './uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/convert', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send({ error: 'No file provided' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    if (path.extname(fileName) !== '.pdf') {
        fs.unlinkSync(filePath);
        return res.status(400).send({ error: 'Only PDF files are supported' });
    }

    const textFilePath = filePath + '.txt';

    exec(`pdftotext ${filePath} ${textFilePath}`, (error, stdout, stderr) => {
        if (error) {
            fs.unlinkSync(filePath);
            fs.unlinkSync(textFilePath);
            return res.status(500).send({ error: 'Failed to convert PDF to text' });
        }

        const text = fs.readFileSync(textFilePath, 'utf8');
        fs.unlinkSync(filePath);
        fs.unlinkSync(textFilePath);

        res.set("Content-Type", "text/plain");
        res.send(text);
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send({ error: 'Internal Server Error' });
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});