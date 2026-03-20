const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);
const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Configure multer with limits and file filtering
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate secure random filename
        const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 20, // Maximum 20 files
        fieldSize: 1024 * 1024 // 1MB for field data
    },
    fileFilter: (req, file, cb) => {
        // Only allow image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only image files are allowed.'));
        }
    }
});

// Validate and sanitize targetSize parameter
function validateTargetSize(targetSize) {
    if (!targetSize) return null;
    
    const sizePattern = /^(\d{1,4})x(\d{1,4})$/;
    const match = targetSize.match(sizePattern);
    
    if (!match) return null;
    
    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    
    // Limit dimensions to prevent resource exhaustion
    if (width < 1 || width > 2000 || height < 1 || height > 2000) {
        return null;
    }
    
    return `${width}x${height}`;
}

// Validate delay parameter
function validateDelay(delay) {
    const parsedDelay = parseInt(delay, 10);
    
    if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 10000) {
        return 10; // Default value
    }
    
    return parsedDelay;
}

// Clean up uploaded files
async function cleanupFiles(files) {
    if (!files || !Array.isArray(files)) return;
    
    for (const file of files) {
        try {
            if (file.path && fs.existsSync(file.path)) {
                await unlinkAsync(file.path);
            }
        } catch (err) {
            console.error('Cleanup error:', err.message);
        }
    }
}

app.post('/create-gif', upload.array('images', 20), async (req, res) => {
    let outputPath = null;
    
    try {
        // Validate request
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        const targetSize = validateTargetSize(req.body.targetSize);
        if (!targetSize) {
            await cleanupFiles(req.files);
            return res.status(400).json({ error: 'Invalid target size. Format should be WIDTHxHEIGHT (e.g., 500x500) with dimensions between 1 and 2000' });
        }
        
        const delay = validateDelay(req.body.delay);
        const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
        
        // Generate output filename
        const outputFilename = crypto.randomBytes(16).toString('hex') + '.gif';
        outputPath = path.join(__dirname, 'uploads', outputFilename);
        
        // Build ImageMagick command with proper escaping
        const inputFiles = req.files.map(file => {
            // Ensure file path is within uploads directory
            const normalizedPath = path.normalize(file.path);
            const uploadsDir = path.join(__dirname, 'uploads');
            
            if (!normalizedPath.startsWith(uploadsDir)) {
                throw new Error('Invalid file path');
            }
            
            return normalizedPath;
        });
        
        // If appendReverted is true, add reversed sequence
        let allFiles = [...inputFiles];
        if (appendReverted && inputFiles.length > 1) {
            allFiles = [...inputFiles, ...inputFiles.slice().reverse()];
        }
        
        // Build command with proper argument escaping
        const command = [
            'convert',
            '-delay', String(Math.round(delay / 10)), // Convert ms to centiseconds
            '-loop', '0',
            '-resize', targetSize,
            ...allFiles.map(f => `"${f}"`),
            `"${outputPath}"`
        ].join(' ');
        
        // Execute with timeout to prevent resource exhaustion
        await execAsync(command, {
            timeout: 30000, // 30 second timeout
            maxBuffer: 50 * 1024 * 1024 // 50MB max buffer
        });
        
        // Check if output file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('Failed to create GIF');
        }
        
        // Send the GIF file
        res.setHeader('Content-Type', 'image/gif');
        const stream = fs.createReadStream(outputPath);
        
        stream.on('end', async () => {
            // Clean up all files after sending
            await cleanupFiles(req.files);
            try {
                if (outputPath && fs.existsSync(outputPath)) {
                    await unlinkAsync(outputPath);
                }
            } catch (err) {
                console.error('Output cleanup error:', err.message);
            }
        });
        
        stream.on('error', async (err) => {
            console.error('Stream error:', err.message);
            await cleanupFiles(req.files);
            if (outputPath && fs.existsSync(outputPath)) {
                try {
                    await unlinkAsync(outputPath);
                } catch (cleanupErr) {
                    console.error('Output cleanup error:', cleanupErr.message);
                }
            }
            
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to send GIF' });
            }
        });
        
        stream.pipe(res);
        
    } catch (error) {
        // Clean up uploaded files on error
        await cleanupFiles(req.files);
        
        if (outputPath && fs.existsSync(outputPath)) {
            try {
                await unlinkAsync(outputPath);
            } catch (cleanupErr) {
                console.error('Output cleanup error:', cleanupErr.message);
            }
        }
        
        // Send appropriate error response without exposing sensitive information
        if (error.message === 'Invalid file type. Only image files are allowed.') {
            return res.status(400).json({ error: error.message });
        } else if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds limit' });
        } else if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files' });
        } else if (error.code === 'ETIMEDOUT' || error.killed) {
            return res.status(500).json({ error: 'Processing timeout' });
        } else {
            console.error('Processing error:', error.message);
            return res.status(500).json({ error: 'Failed to process images' });
        }
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    
    // Clean up any uploaded files
    if (req.files) {
        cleanupFiles(req.files).catch(cleanupErr => {
            console.error('Cleanup error in error handler:', cleanupErr.message);
        });
    }
    
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down server...');
    process.exit(0);
});