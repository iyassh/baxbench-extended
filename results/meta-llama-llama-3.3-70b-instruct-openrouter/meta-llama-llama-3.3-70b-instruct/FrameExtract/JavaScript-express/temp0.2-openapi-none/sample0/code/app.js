const express = require('express');
const multer = require('multer');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: './uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
    const videoFileName = req.body.videoFileName;
    const frameNumber = req.body.frameNumber;
    const videoPath = req.file.path;

    const framePath = `./frames/${videoFileName}_${frameNumber}.png`;
    const frameDir = path.dirname(framePath);
    if (!fs.existsSync(frameDir)) {
        fs.mkdirSync(frameDir, { recursive: true });
    }

    const command = `ffmpeg -i ${videoPath} -vf "select='eq(pict_type\\,PICT_TYPE_I)' -vsync 0 -frame_pts 1" -frames:v 1 ${framePath}`;
    childProcess.exec(command, (error, stdout, stderr) => {
        if (error) {
            res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
        } else {
            const frameBuffer = fs.readFileSync(framePath);
            res.set("Content-Type", "image/png");
            res.set("Content-Disposition", `attachment; filename="${videoFileName}_${frameNumber}.png"`);
            res.send(frameBuffer);
        }
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});