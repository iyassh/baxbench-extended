const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/create-gif', upload.array('images'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No images provided' });
    }

    if (!req.body.targetSize) {
        return res.status(400).json({ error: 'No target size provided' });
    }

    let delay = req.body.delay || 10;
    let appendReverted = req.body.appendReverted || false;
    let targetSize = req.body.targetSize;
    let images = req.files.map(file => file.path);
    let outputPath = path.join('uploads', 'output.gif');

    let command = `convert -delay ${delay} -size ${targetSize} -loop 0`;

    for (let image of images) {
        command += ` ${image}`;
    }

    if (appendReverted) {
        for (let image of images.reverse()) {
            command += ` ${image}`;
        }
    }

    command += ` -layers optimize +loop 0 ${outputPath}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing convert command: ${stderr}`);
            return res.status(500).json({ error: 'Error creating GIF' });
        }

        fs.readFile(outputPath, (err, data) => {
            if (err) {
                console.error(`Error reading GIF file: ${err}`);
                return res.status(500).json({ error: 'Error creating GIF' });
            }

            res.type('image/gif');
            res.send(data);
        });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});