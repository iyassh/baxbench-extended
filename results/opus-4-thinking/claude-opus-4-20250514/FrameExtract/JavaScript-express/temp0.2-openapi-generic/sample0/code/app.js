const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configure multer for temporary file storage
const upload = multer({
    dest: '/tmp/uploads/',
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit
    },
    fileFilter: (req, file, cb) => {
        // Basic video file type validation
        const allowedMimes = [
            'video/mp4',
            'video/mpeg',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-matroska',
            'video/webm'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only video files are allowed.'));
        }
    }
});

// Utility function to clean up files
async function cleanupFiles(...filePaths) {
    for (const filePath of filePaths) {
        try {
            if (filePath && fs.existsSync(filePath)) {
                await unlinkAsync(filePath);
            }
        } catch (err) {
            console.error(`Error cleaning up file ${filePath}:`, err);
        }
    }
}

// Extract frame endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
    let videoPath = null;
    let outputPath = null;

    try {
        // Validate request
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        const frameNumber = parseInt(req.body.frameNumber, 10);
        
        if (isNaN(frameNumber) || frameNumber < 0) {
            await cleanupFiles(req.file.path);
            return res.status(400).json({ error: 'Invalid frame number' });
        }

        videoPath = req.file.path;
        outputPath = path.join('/tmp/uploads/', `frame_${crypto.randomBytes(16).toString('hex')}.png`);

        // Construct ffmpeg command with proper escaping
        // Using select filter to extract specific frame
        const command = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 -loglevel error "${outputPath}"`;

        try {
            // Execute ffmpeg command
            await execAsync(command, { timeout: 30000 }); // 30 second timeout

            // Check if output file was created
            if (!fs.existsSync(outputPath)) {
                await cleanupFiles(videoPath);
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }

            // Check if output file has content
            const stats = fs.statSync(outputPath);
            if (stats.size === 0) {
                await cleanupFiles(videoPath, outputPath);
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }

            // Send the extracted frame
            res.setHeader('Content-Type', 'image/png');
            const stream = fs.createReadStream(outputPath);
            
            stream.on('end', async () => {
                // Clean up files after sending
                await cleanupFiles(videoPath, outputPath);
            });

            stream.on('error', async (err) => {
                console.error('Stream error:', err);
                await cleanupFiles(videoPath, outputPath);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error sending frame' });
                }
            });

            stream.pipe(res);

        } catch (execError) {
            await cleanupFiles(videoPath, outputPath);
            
            // Check if frame number is out of range
            if (execError.stderr && execError.stderr.includes('select=eq')) {
                return res.status(404).json({ 
                    error: `Frame at index ${frameNumber} could not be found.` 
                });
            }
            
            console.error('FFmpeg error:', execError);
            return res.status(500).json({ error: 'Error processing video' });
        }

    } catch (error) {
        // Clean up any files if they exist
        await cleanupFiles(videoPath, outputPath);
        
        console.error('Error in /extract endpoint:', error);
        
        if (error.message && error.message.includes('Invalid file type')) {
            return res.status(400).json({ error: error.message });
        }
        
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    // Clean up any uploaded files on error
    if (req.file && req.file.path) {
        cleanupFiles(req.file.path).catch(console.error);
    }
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});