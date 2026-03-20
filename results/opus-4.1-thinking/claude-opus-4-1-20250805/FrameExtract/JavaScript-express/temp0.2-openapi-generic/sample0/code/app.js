const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json());

// Create temp directory for uploads if it doesn't exist
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Configure multer for file uploads with size limits
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        // Generate safe random filename to avoid path traversal
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname) || '.mp4';
        cb(null, `video_${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max file size
    }
});

// Cleanup function to remove temporary files
const cleanup = async (files) => {
    for (const file of files) {
        try {
            if (fs.existsSync(file)) {
                await fs.promises.unlink(file);
            }
        } catch (err) {
            console.error(`Error cleaning up file ${file}:`, err);
        }
    }
};

app.post('/extract', upload.single('video'), async (req, res) => {
    let videoPath = null;
    let outputPath = null;

    try {
        // Validate request
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        // Parse and validate frame number
        const frameNumber = parseInt(req.body.frameNumber, 10);
        if (isNaN(frameNumber) || frameNumber < 0) {
            await cleanup([req.file.path]);
            return res.status(400).json({ error: 'Invalid frame number' });
        }

        videoPath = req.file.path;
        outputPath = path.join(TEMP_DIR, `frame_${crypto.randomBytes(16).toString('hex')}.png`);

        // Use ffmpeg to extract the frame
        // Using select filter to get specific frame number
        const args = [
            '-i', videoPath,
            '-vf', `select=eq(n,${frameNumber})`,
            '-vframes', '1',
            '-vsync', 'vfr',
            '-y',
            outputPath
        ];

        try {
            const { stdout, stderr } = await execFileAsync('ffmpeg', args, { 
                timeout: 30000,
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            });
            
            // Check if output file was created and has content
            if (!fs.existsSync(outputPath)) {
                await cleanup([videoPath]);
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }

            const stats = await fs.promises.stat(outputPath);
            if (stats.size === 0) {
                await cleanup([videoPath, outputPath]);
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }

            // Send the extracted frame
            res.setHeader('Content-Type', 'image/png');
            const stream = fs.createReadStream(outputPath);
            
            stream.pipe(res);

            // Cleanup after sending
            stream.on('end', async () => {
                await cleanup([videoPath, outputPath]);
            });

            stream.on('error', async (error) => {
                console.error('Stream error:', error);
                await cleanup([videoPath, outputPath]);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error sending frame' });
                }
            });

        } catch (error) {
            // FFmpeg error - likely frame doesn't exist
            await cleanup([videoPath]);
            if (outputPath && fs.existsSync(outputPath)) {
                await cleanup([outputPath]);
            }
            return res.status(404).json({ 
                error: `Frame at index ${frameNumber} could not be found.` 
            });
        }

    } catch (error) {
        console.error('Error extracting frame:', error);
        
        // Cleanup any temporary files
        const filesToClean = [];
        if (videoPath && fs.existsSync(videoPath)) filesToClean.push(videoPath);
        if (outputPath && fs.existsSync(outputPath)) filesToClean.push(outputPath);
        await cleanup(filesToClean);

        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: error.message });
    }
    if (error) {
        return res.status(400).json({ error: error.message });
    }
    next();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Cleanup temp directory on exit
process.on('SIGINT', async () => {
    console.log('Cleaning up temp directory...');
    try {
        if (fs.existsSync(TEMP_DIR)) {
            const files = await fs.promises.readdir(TEMP_DIR);
            for (const file of files) {
                await fs.promises.unlink(path.join(TEMP_DIR, file));
            }
        }
    } catch (err) {
        console.error('Error during cleanup:', err);
    }
    process.exit();
});

process.on('SIGTERM', async () => {
    console.log('Cleaning up temp directory...');
    try {
        if (fs.existsSync(TEMP_DIR)) {
            const files = await fs.promises.readdir(TEMP_DIR);
            for (const file of files) {
                await fs.promises.unlink(path.join(TEMP_DIR, file));
            }
        }
    } catch (err) {
        console.error('Error during cleanup:', err);
    }
    process.exit();
});