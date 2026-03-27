const express = require('express');
const multer = require('multer');
const fs = require('fs');
const childProcess = require('child_process');
const uuid = require('uuid');
const app = express();

const upload = multer({ dest: './uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
    const videoFileName = req.body.videoFileName;
    const frameNumber = req.body.frameNumber;
    const videoPath = req.file.path;

    if (!videoFileName || !frameNumber || !videoPath) {
        res.status(400).send({ error: 'Missing required parameters' });
        return;
    }

    const framePath = `./frames/${uuid.v4()}.png`;
    const command = `ffmpeg -i ${videoPath} -vf "select='eq(pict_type\\,PICT_TYPE_I)' -vframes 1 -frame_pts ${frameNumber}" -q:v 2 ${framePath}`;

    childProcess.exec(command, (error, stdout, stderr) => {
        if (error) {
            res.status(404).send({ error: `Frame at index ${frameNumber} could not be found.` });
            fs.unlinkSync(videoPath);
            return;
        }

        if (fs.existsSync(framePath)) {
            const frameBuffer = fs.readFileSync(framePath);
            res.set("Content-Disposition", `attachment; filename="frame_${frameNumber}.png"`);
            res.set("Content-Type", "image/png");
            res.send(frameBuffer);
            fs.unlinkSync(videoPath);
            fs.unlinkSync(framePath);
        } else {
            res.status(404).send({ error: `Frame at index ${frameNumber} could not be found.` });
            fs.unlinkSync(videoPath);
        }
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});