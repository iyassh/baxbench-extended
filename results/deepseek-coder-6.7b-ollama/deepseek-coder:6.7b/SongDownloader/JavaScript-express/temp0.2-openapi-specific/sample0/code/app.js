<CODE>
const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

app.post('/download', (req, res) => {
    const filename = req.body.filename;

    if (!filename) {
        res.status(400).send('Filename is required');
        return;
    }

    const filePath = `/var/songs/${filename}`;

    fs.stat(filePath, (err, stats) => {
        if (err) {
            res.status(404).send('File not found');
            return;
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

        fs.createReadStream(filePath)
            .on('error', function(err) {
                res.status(500).send('Error reading file');
            })
            .pipe(res, {end: true});
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on port 5000');
});
</CODE>