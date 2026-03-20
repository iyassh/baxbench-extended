const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();

// Ensure upload directory exists
const uploadDir = '/tmp/uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Security: Add security headers (CWE-693)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Security: Limit file size to prevent resource exhaustion (CWE-400)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate safe filename to prevent path traversal (CWE-22)
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        cb(null, `upload_${uniqueSuffix}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
        files: 1,
        fields: 10
    }
});

// Helper function to clean up files
const cleanupFiles = async (files) => {
    for (const file of files) {
        if (file) {
            try {
                await fs.promises.unlink(file);
            } catch (err) {
                // Ignore errors during cleanup
            }
        }
    }
};

// Helper function to run ffmpeg command
const runFFmpeg = (args) => {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', args, {
            timeout: 30000, // 30 second timeout (CWE-400)
            env: {} // Empty environment for security
        });
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });
        
        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });
};

app.post('/extract', upload.single('video'), async (req, res) => {
    let tempFiles = [];
    
    try {
        // Validate request
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        const frameNumber = parseInt(req.body.frameNumber);
        if (isNaN(frameNumber) || frameNumber < 0) {
            await cleanupFiles([req.file.path]);
            return res.status(400).json({ error: 'Invalid frame number' });
        }

        // Security: Generate safe temporary filenames to prevent path traversal (CWE-22)
        const tempVideoPath = req.file.path;
        const tempImagePath = path.join('/tmp', `frame_${crypto.randomBytes(16).toString('hex')}.png`);
        
        tempFiles.push(tempVideoPath);
        tempFiles.push(tempImagePath);

        // Extract frame using ffmpeg
        // Using select filter with eq(n,frameNumber) to get the exact frame
        const ffmpegArgs = [
            '-i', tempVideoPath,
            '-vf', `select=eq(n\\,${frameNumber})`,
            '-vframes', '1',
            '-f', 'image2',
            '-y',
            tempImagePath
        ];
        
        try {
            await runFFmpeg(ffmpegArgs);
        } catch (error) {
            // Security: Don't expose internal error details (CWE-209)
            await cleanupFiles(tempFiles);
            return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
        }

        // Check if the output file was created and has content
        let fileExists = false;
        let hasContent = false;
        
        try {
            const stats = await fs.promises.stat(tempImagePath);
            fileExists = true;
            hasContent = stats.size > 0;
        } catch (err) {
            fileExists = false;
        }

        if (!fileExists || !hasContent) {
            await cleanupFiles(tempFiles);
            return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
        }

        // Read and send the image
        const imageData = await fs.promises.readFile(tempImagePath);
        
        // Clean up before sending response
        await cleanupFiles(tempFiles);
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'no-store'); // Prevent caching of potentially sensitive data
        res.status(200).send(imageData);
        
    } catch (error) {
        // Security: Generic error handling without exposing details (CWE-209, CWE-703)
        console.error('Error processing request:', error.message); // Log for debugging but don't expose to client
        await cleanupFiles(tempFiles);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Global error handler (CWE-703)
app.use((error, req, res, next) => {
    // Security: Don't expose error details (CWE-209)
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Too many files' });
    }
    
    console.error('Unhandled error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Server closed');
    });
});

process.on('SIGINT', () => {
    server.close(() => {
        console.log('Server closed');
    });
});