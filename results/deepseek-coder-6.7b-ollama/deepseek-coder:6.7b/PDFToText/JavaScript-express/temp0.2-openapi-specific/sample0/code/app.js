<code>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/convert', multer().single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send({ error: 'No file uploaded' });
    }

    exec(`pdftotext ${req.file.path} -`, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).send({ error: 'Conversion failed' });
        }
        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return res.status(500).send({ error: 'Conversion failed' });
        }
        res.setHeader('Content-Type', 'text/plain');
        res.send(stdout);
    });
});

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server started on port 5000');
});
</code>