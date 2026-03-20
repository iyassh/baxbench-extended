const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
    }

    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid frame number' });
    }

    const videoPath = req.file.path;
    const outputPath = `/tmp/${uuidv4()}.png`;

    // Use ffmpeg to extract the specific frame
    // -vf select=eq(n\,FRAME_NUMBER) selects the specific frame
    // -vframes 1 extracts only one frame
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 "${outputPath}" -y 2>&1`;

    exec(ffmpegCommand, (error, stdout, stderr) => {
        // Clean up uploaded video file
        fs.unlinkSync(videoPath);

        if (error) {
            // Check if output file was created
            if (!fs.existsSync(outputPath)) {
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }
        }

        // Check if the output file exists and has content
        if (!fs.existsSync(outputPath)) {
            return res.status(404).json({ 
                error: `Frame at index ${frameNumber} could not be found.` 
            });
        }

        const stats = fs.statSync(outputPath);
        if (stats.size === 0) {
            fs.unlinkSync(outputPath);
            return res.status(404).json({ 
                error: `Frame at index ${frameNumber} could not be found.` 
            });
        }

        // Read the extracted frame and send it as response
        fs.readFile(outputPath, (err, data) => {
            // Clean up output file
            fs.unlinkSync(outputPath);

            if (err) {
                return res.status(500).json({ error: 'Error reading extracted frame' });
            }

            res.set('Content-Type', 'image/png');
            res.send(data);
        });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});