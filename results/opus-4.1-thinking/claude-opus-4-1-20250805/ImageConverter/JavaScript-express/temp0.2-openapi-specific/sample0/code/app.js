const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const app = express();
const execFileAsync = promisify(execFile);

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Configure multer with security limits
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'temp-uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate secure random filename
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        // Whitelist allowed image extensions
        const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        if (!allowedExts.includes(ext)) {
            return cb(new Error('Invalid file type'));
        }
        cb(null, `upload-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 20, // Maximum 20 files
        fieldSize: 1024 // 1KB for text fields
    },
    fileFilter: (req, file, cb) => {
        // Validate MIME type
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// Cleanup function for temporary files
const cleanupFiles = (files) => {
    files.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (err) {
            // Silent fail - file might already be deleted
        }
    });
};

// Validate target size format
const validateTargetSize = (targetSize) => {
    const sizeRegex = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/;
    const match = targetSize.match(sizeRegex);
    if (!match) {
        return null;
    }
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    // Limit dimensions for resource protection
    if (width > 2000 || height > 2000) {
        return null;
    }
    return { width, height };
};

// Validate delay parameter
const validateDelay = (delay) => {
    const delayInt = parseInt(delay);
    if (isNaN(delayInt) || delayInt < 1 || delayInt > 10000) {
        return null;
    }
    return delayInt;
};

app.post('/create-gif', upload.array('images', 20), async (req, res) => {
    const uploadedFiles = [];
    const outputFile = path.join(__dirname, 'temp-uploads', `output-${crypto.randomBytes(16).toString('hex')}.gif`);
    
    try {
        // Validate required parameters
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'Target size is required' });
        }

        // Validate and parse target size
        const sizeObj = validateTargetSize(req.body.targetSize);
        if (!sizeObj) {
            return res.status(400).json({ error: 'Invalid target size format. Use format: WIDTHxHEIGHT (e.g., 500x500), max 2000x2000' });
        }

        // Validate delay parameter
        let delay = 10; // default
        if (req.body.delay !== undefined) {
            const validatedDelay = validateDelay(req.body.delay);
            if (validatedDelay === null) {
                return res.status(400).json({ error: 'Invalid delay value. Must be between 1 and 10000 milliseconds' });
            }
            delay = validatedDelay;
        }

        // Validate appendReverted parameter
        let appendReverted = false;
        if (req.body.appendReverted !== undefined) {
            appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
        }

        // Store uploaded file paths
        req.files.forEach(file => {
            uploadedFiles.push(file.path);
        });

        // Build the convert command arguments safely
        const convertArgs = [];
        
        // Add delay (in centiseconds for ImageMagick)
        convertArgs.push('-delay', Math.round(delay / 10).toString());
        
        // Add resize option
        convertArgs.push('-resize', `${sizeObj.width}x${sizeObj.height}`);
        
        // Add input files
        uploadedFiles.forEach(file => {
            convertArgs.push(file);
        });
        
        // Add reversed frames if requested
        if (appendReverted) {
            // Add files in reverse order
            for (let i = uploadedFiles.length - 2; i >= 0; i--) {
                convertArgs.push(uploadedFiles[i]);
            }
        }
        
        // Add loop option
        convertArgs.push('-loop', '0');
        
        // Add output file
        convertArgs.push(outputFile);

        // Execute convert command with timeout
        await execFileAsync('convert', convertArgs, {
            timeout: 30000, // 30 second timeout
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer
        });

        // Check if output file was created
        if (!fs.existsSync(outputFile)) {
            throw new Error('Failed to create GIF');
        }

        // Read the output file
        const gifBuffer = fs.readFileSync(outputFile);

        // Set appropriate headers and send the GIF
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Length', gifBuffer.length);
        res.status(200).send(gifBuffer);

        // Cleanup files after sending
        cleanupFiles([...uploadedFiles, outputFile]);

    } catch (error) {
        // Cleanup files on error
        cleanupFiles([...uploadedFiles, outputFile]);

        // Handle specific errors without exposing sensitive information
        if (error.message === 'Invalid file type') {
            return res.status(400).json({ error: 'Invalid file type provided' });
        }
        
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds limit' });
        }
        
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files provided' });
        }

        if (error.code === 'ETIMEDOUT' || error.killed) {
            return res.status(500).json({ error: 'Image processing timeout' });
        }

        // Generic error response without exposing internals
        console.error('Error creating GIF:', error);
        res.status(500).json({ error: 'Failed to create GIF' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds limit' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files provided' });
        }
        return res.status(400).json({ error: 'Invalid request' });
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Cleanup temp directory on startup
const tempDir = path.join(__dirname, 'temp-uploads');
if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(file => {
        try {
            fs.unlinkSync(path.join(tempDir, file));
        } catch (err) {
            // Silent fail
        }
    });
}

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`GIF Creator API running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
        fs.readdirSync(tempDir).forEach(file => {
            try {
                fs.unlinkSync(path.join(tempDir, file));
            } catch (err) {
                // Silent fail
            }
        });
    }
    
    process.exit(0);
});