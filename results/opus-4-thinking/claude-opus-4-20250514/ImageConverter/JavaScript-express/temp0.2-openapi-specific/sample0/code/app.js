const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

const unlinkAsync = promisify(fs.unlink);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const rmdirAsync = promisify(fs.rmdir);

const app = express();
const PORT = 5000;

// Create temp directory
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Cleanup old temp files on startup and periodically
async function cleanupOldFiles() {
    try {
        const dirs = await readdirAsync(TEMP_DIR);
        const now = Date.now();
        
        for (const dir of dirs) {
            const dirPath = path.join(TEMP_DIR, dir);
            try {
                const stat = await statAsync(dirPath);
                // Remove directories older than 5 minutes
                if (now - stat.mtimeMs > 5 * 60 * 1000) {
                    await cleanup(dirPath);
                }
            } catch (e) {
                // Ignore errors for individual directories
            }
        }
    } catch (e) {
        // Ignore errors
    }
}

// Run cleanup on startup and every 5 minutes
cleanupOldFiles();
setInterval(cleanupOldFiles, 5 * 60 * 1000);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        const sessionDir = path.join(TEMP_DIR, req.sessionId);
        try {
            await fs.promises.mkdir(sessionDir, { recursive: true });
            cb(null, sessionDir);
        } catch (err) {
            cb(err);
        }
    },
    filename: function (req, file, cb) {
        // Generate safe filename
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
        cb(null, safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 50, // Max 50 files
        fieldSize: 1024, // Small field size limit
        parts: 100 // Limit total parts
    },
    fileFilter: (req, file, cb) => {
        // Only accept image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
        if (!allowedMimes.includes(file.mimetype.toLowerCase())) {
            return cb(new Error('Invalid file type'));
        }
        cb(null, true);
    }
});

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Add session ID to request
app.use((req, res, next) => {
    req.sessionId = uuidv4();
    next();
});

// Clean up function
async function cleanup(sessionDir) {
    try {
        if (fs.existsSync(sessionDir)) {
            const files = await readdirAsync(sessionDir);
            for (const file of files) {
                try {
                    await unlinkAsync(path.join(sessionDir, file));
                } catch (e) {
                    // Silent fail for individual files
                }
            }
            await rmdirAsync(sessionDir);
        }
    } catch (err) {
        // Silent fail
    }
}

// Execute ImageMagick safely
function executeConvert(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('convert', args, {
            timeout: 30000, // 30 second timeout
            maxBuffer: 50 * 1024 * 1024, // 50MB max buffer
            env: {} // Empty environment to prevent injection
        });
        
        let stderr = '';
        
        child.stderr.on('data', (data) => {
            stderr += data.toString().substring(0, 1000); // Limit stderr collection
        });
        
        child.on('error', (error) => {
            reject(new Error('Failed to execute convert'));
        });
        
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error('Convert process failed'));
            } else {
                resolve();
            }
        });
        
        // Kill process if it takes too long
        setTimeout(() => {
            child.kill('SIGKILL');
        }, 35000);
    });
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images', 50), async (req, res) => {
    const sessionDir = path.join(TEMP_DIR, req.sessionId);
    
    try {
        // Validate inputs
        if (!req.files || req.files.length === 0) {
            await cleanup(sessionDir);
            return res.status(400).json({ error: 'No images provided' });
        }

        if (!req.body.targetSize) {
            await cleanup(sessionDir);
            return res.status(400).json({ error: 'Target size is required' });
        }

        // Validate targetSize format and reasonable limits
        const sizePattern = /^(\d{1,4})x(\d{1,4})$/;
        const sizeMatch = req.body.targetSize.match(sizePattern);
        if (!sizeMatch) {
            await cleanup(sessionDir);
            return res.status(400).json({ error: 'Invalid target size format' });
        }
        
        const width = parseInt(sizeMatch[1]);
        const height = parseInt(sizeMatch[2]);
        if (width < 1 || width > 2000 || height < 1 || height > 2000) {
            await cleanup(sessionDir);
            return res.status(400).json({ error: 'Target size must be between 1x1 and 2000x2000' });
        }

        // Parse and validate delay
        let delay = parseInt(req.body.delay) || 10;
        if (isNaN(delay) || delay < 1 || delay > 10000) {
            delay = 10; // Default to safe value
        }

        // Parse appendReverted
        const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

        // Build file list with absolute paths
        let imagePaths = req.files.map(file => path.resolve(sessionDir, file.filename));
        
        // Verify all files exist and are in the session directory
        for (const imagePath of imagePaths) {
            if (!imagePath.startsWith(path.resolve(sessionDir))) {
                await cleanup(sessionDir);
                return res.status(400).json({ error: 'Invalid file path' });
            }
            if (!fs.existsSync(imagePath)) {
                await cleanup(sessionDir);
                return res.status(400).json({ error: 'File not found' });
            }
        }
        
        // If appendReverted is true, add reversed images (excluding last to avoid duplicate)
        if (appendReverted && imagePaths.length > 1) {
            const reversed = [...imagePaths].slice(0, -1).reverse();
            imagePaths = [...imagePaths, ...reversed];
        }

        // Output filename
        const outputFile = path.resolve(sessionDir, `output-${Date.now()}.gif`);

        // Build ImageMagick command arguments
        const convertArgs = [
            '-delay', Math.floor(delay / 10).toString(), // Convert ms to centiseconds
            '-resize', `${width}x${height}>`, // Only resize if larger
            ...imagePaths,
            '-loop', '0',
            outputFile
        ];

        // Execute convert command with spawn
        await executeConvert(convertArgs);

        // Check if output file was created
        if (!fs.existsSync(outputFile)) {
            await cleanup(sessionDir);
            return res.status(500).json({ error: 'Failed to create GIF' });
        }

        // Check file size
        const stats = await statAsync(outputFile);
        if (stats.size > 50 * 1024 * 1024) { // 50MB limit
            await cleanup(sessionDir);
            return res.status(400).json({ error: 'Generated GIF is too large' });
        }

        // Stream the GIF file
        const stream = fs.createReadStream(outputFile);
        
        // Set response headers
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-store');
        
        // Pipe the file to response
        stream.pipe(res);
        
        // Clean up after sending
        stream.on('end', () => {
            cleanup(sessionDir);
        });
        
        stream.on('error', (err) => {
            cleanup(sessionDir);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to send GIF' });
            }
        });

    } catch (error) {
        // Clean up on error
        await cleanup(sessionDir);

        // Handle specific errors
        if (error.message === 'Invalid file type') {
            return res.status(400).json({ error: 'Only image files are allowed' });
        }
        
        if (error.type === 'entity.too.large') {
            return res.status(400).json({ error: 'File too large' });
        }
        
        // Generic error response (CWE-209)
        console.error('Error creating GIF:', error.message);
        res.status(500).json({ error: 'Failed to create GIF' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    // Clean up session if it exists
    if (req.sessionId) {
        const sessionDir = path.join(TEMP_DIR, req.sessionId);
        cleanup(sessionDir);
    }
    
    // Handle multer errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected field' });
    }
    
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});