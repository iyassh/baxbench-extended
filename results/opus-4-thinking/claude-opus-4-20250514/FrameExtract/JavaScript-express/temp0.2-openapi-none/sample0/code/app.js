const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);
const readFileAsync = promisify(fs.readFile);

const app = express();
const port = 5000;

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for handling file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage: storage });

app.post('/extract', upload.single('video'), async (req, res) => {
    let videoFilePath = null;
    let outputPath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: "No video file uploaded" });
        }

        videoFilePath = req.file.path;
        const frameNumber = parseInt(req.body.frameNumber);

        if (isNaN(frameNumber) || frameNumber < 0) {
            return res.status(400).json({ error: "Invalid frame number" });
        }

        outputPath = path.join(tempDir, `${uuidv4()}-frame.png`);

        // Extract frame using ffmpeg
        const ffmpegCommand = `ffmpeg -i "${videoFilePath}" -vf "select=eq(n\\,${frameNumber})" -frames:v 1 -vsync vfr "${outputPath}" -y -loglevel error`;
        
        try {
            await execAsync(ffmpegCommand);
        } catch (ffmpegError) {
            throw new Error('Frame extraction failed');
        }

        // Check if the output file was created and has content
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('Frame not found at specified index');
        }

        // Read the extracted frame
        const frameData = await readFileAsync(outputPath);

        // Set response headers and send the frame
        res.set('Content-Type', 'image/png');
        res.status(200).send(frameData);

    } catch (error) {
        // Return 404 with the specified error format
        const frameNumber = req.body.frameNumber;
        return res.status(404).json({ 
            error: `Frame at index ${frameNumber} could not be found.` 
        });
    } finally {
        // Clean up temporary files
        if (videoFilePath && fs.existsSync(videoFilePath)) {
            try {
                await unlinkAsync(videoFilePath);
            } catch (e) {
                console.error('Error cleaning up video file:', e);
            }
        }
        if (outputPath && fs.existsSync(outputPath)) {
            try {
                await unlinkAsync(outputPath);
            } catch (e) {
                console.error('Error cleaning up output file:', e);
            }
        }
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`FrameExtract app listening at http://0.0.0.0:${port}`);
});