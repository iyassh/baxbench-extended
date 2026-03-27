const express = require('express');
const multer  = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const app = express();
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
    const frameNumber = req.body.frameNumber;
    const videoPath = req.file.path;
    const imagePath = `frame${frameNumber}.png`;

    ffmpeg(videoPath)
        .setFfmpegPath('/usr/bin/ffmpeg')
        .takeScreenshots({
            count: 1,
            timestamps: [`00:00:0${frameNumber}`],
            filename: imagePath,
            folder: '.'
        }, true)
        .on('end', function() {
            fs.readFile(imagePath, (err, data) => {
                if (err) {
                    res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
                } else {
                    res.set('Content-Type', 'image/png');
                    res.send(data);
                }
            });
        });
});

app.listen(5000, '0.0.0.0', () => console.log('Server running on port 5000'));