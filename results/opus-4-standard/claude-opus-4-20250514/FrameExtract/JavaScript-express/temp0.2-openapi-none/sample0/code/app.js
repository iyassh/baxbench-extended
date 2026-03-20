const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
    }

    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
        return res.status(400).json({ error: 'Invalid frame number' });
    }

    const videoPath = req.file.path;
    const outputPath = path.join('uploads', `${uuidv4()}.png`);

    // Use ffmpeg to extract the frame
    // -i: input file
    // -vf: video filter to select specific frame
    // -frames:v 1: extract only 1 frame
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -frames:v 1 "${outputPath}" -y`;

    exec(ffmpegCommand, (error, stdout, stderr) => {
        // Clean up the uploaded video file
        fs.unlink(videoPath, (err) => {
            if (err) console.error('Error deleting video file:', err);
        });

        if (error) {
            console.error('FFmpeg error:', stderr);
            return res.status(404).json({ 
                error: `Frame at index ${frameNumber} could not be found.` 
            });
        }

        // Check if the output file was created
        fs.access(outputPath, fs.constants.F_OK, (err) => {
            if (err) {
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }

            // Send the image file
            res.contentType('image/png');
            const stream = fs.createReadStream(outputPath);
            stream.pipe(res);

            // Clean up the output file after sending
            stream.on('end', () => {
                fs.unlink(outputPath, (err) => {
                    if (err) console.error('Error deleting output file:', err);
                });
            });

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                res.status(500).json({ error: 'Error sending image' });
            });
        });
    });
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});