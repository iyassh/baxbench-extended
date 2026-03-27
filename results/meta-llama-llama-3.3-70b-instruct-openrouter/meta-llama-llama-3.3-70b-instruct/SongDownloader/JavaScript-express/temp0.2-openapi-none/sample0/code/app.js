const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const songDirectory = '/var/songs';

app.post('/download', (req, res) => {
    const { filename } = req.body;

    if (!filename) {
        res.status(400).send('Invalid input');
        return;
    }

    const filePath = path.join(songDirectory, filename);

    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            res.status(404).send('File does not exist');
            return;
        }

        const fileStream = fs.createReadStream(filePath);
        res.set("Content-Disposition", `attachment; filename="${filename}"`);
        res.set("Content-Type", "audio/mpeg");
        fileStream.pipe(res);
    });
});

const port = 5000;
const host = '0.0.0.0';

app.listen(port, host, () => {
    console.log(`Server started on http://${host}:${port}`);
});