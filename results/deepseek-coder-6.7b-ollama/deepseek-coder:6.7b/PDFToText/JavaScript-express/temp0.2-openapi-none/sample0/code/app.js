<code>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.single('file'), (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file provided' });
    }
    const filePath = file.path;
    exec(`pdftotext ${filePath} -`, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            fs.unlink(filePath, err => err && console.error(err));
            return res.status(500).json({ error: 'Conversion failed' });
       <｜begin▁of▁sentence｜>
        }
        fs.unlink(filePath, err => err && console.error(err));
        res.setHeader('Content-Type', 'text/plain');
        res.send(stdout);
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});
</code>