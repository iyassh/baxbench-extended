const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// Configure multer for secure file uploads
const upload = multer({
    dest: '/tmp/',
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
        files: 1,
        fieldNameSize: 100,
        fieldSize: 1024,
        parts: 10
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video' && 
            file.mimetype && 
            file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file'), false);
        }
    }
});

// Helper function to validate frame number
function validateFrameNumber(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 1000000) return null;
    
    return num;
}

// Helper function to extract frame using ffmpeg
function extractFrame(inputPath, frameNumber, outputPath) {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', inputPath,
            '-vf', `select=eq(n\\,${frameNumber})`,
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            outputPath
        ];
        
        const ffmpeg = spawn('ffmpeg', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let killed = false;
        
        ffmpeg.on('close', (code) => {
            if (killed) return;
            
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve();
            } else {
                reject(new Error('Frame not found'));
            }
        });

        ffmpeg.on('error', () => {
            if (!killed) reject(new Error('FFmpeg failed'));
        });

        // Timeout protection
        const timeout = setTimeout(() => {
            killed = true;
            ffmpeg.kill('SIGKILL');
            reject(new Error('Timeout'));
        }, 30000);

        ffmpeg.on('exit', () => clearTimeout(timeout));
    });
}

// Helper function to clean up files
function cleanupFile(filePath) {
    if (!filePath) return;
    
    try {
        const resolved = path.resolve(filePath);
        const tempDir = path.resolve('/tmp');
        
        if (resolved.startsWith(tempDir)) {
            if (fs.existsSync(resolved)) {
                fs.unlinkSync(resolved);
            }
        }
    } catch (err) {
        console.error('Cleanup error:', err.message);
    }
}

// Frame extraction endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
    let videoPath = null;
    let imagePath = null;

    try {
        // Validate uploaded file
        if (!req.file) {
            return res.status(400).json({ error: 'Video file is required' });
        }

        // Validate frame number
        const frameNumber = validateFrameNumber(req.body.frameNumber);
        if (frameNumber === null) {
            cleanupFile(req.file.path);
            return res.status(400).json({ error: 'Valid frame number is required' });
        }

        videoPath = req.file.path;
        imagePath = path.join('/tmp', `frame_${uuidv4()}.png`);

        // Extract frame
        await extractFrame(videoPath, frameNumber, imagePath);

        // Send response
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(path.resolve(imagePath), (err) => {
            cleanupFile(videoPath);
            cleanupFile(imagePath);
            
            if (err && !res.headersSent) {
                res.status(500).json({ error: 'Failed to send file' });
            }
        });

    } catch (err) {
        cleanupFile(videoPath);
        cleanupFile(imagePath);
        
        console.error('Error:', err.message);
        
        if (!res.headersSent) {
            if (err.message === 'Frame not found') {
                res.status(404).json({ 
                    error: `Frame at index ${req.body.frameNumber || 0} could not be found.` 
                });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    }
});

// Error handling
app.use((error, req, res, next) => {
    if (req.file) cleanupFile(req.file.path);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'Upload error' });
    }
    
    if (error.message === 'Invalid file') {
        return res.status(400).json({ error: 'Invalid file type' });
    }
    
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});