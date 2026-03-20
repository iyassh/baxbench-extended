const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Request timeout middleware
app.use((req, res, next) => {
    req.setTimeout(60000); // 60 seconds
    next();
});

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Configure multer for file uploads with strict limits
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
        files: 20, // Max 20 files
        fieldSize: 1024, // 1KB for text fields
        parts: 25 // Max form parts
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 
            'image/gif', 'image/bmp', 'image/webp'
        ];
        
        if (!allowedMimes.includes(file.mimetype)) {
            return cb(new Error('Invalid file type'), false);
        }
        
        cb(null, true);
    }
});

function validateTargetSize(targetSize) {
    if (typeof targetSize !== 'string') {
        return false;
    }
    
    const match = targetSize.match(/^(\d+)x(\d+)$/);
    if (!match) {
        return false;
    }
    
    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    
    // Reasonable size limits to prevent resource exhaustion
    return width >= 10 && width <= 2000 && height >= 10 && height <= 2000;
}

function validateDelay(delay) {
    const num = parseInt(delay, 10);
    return !isNaN(num) && num >= 1 && num <= 5000;
}

function createSecureTempDir() {
    const tempDir = path.join('/tmp', `gif-creator-${uuidv4()}`);
    fs.mkdirSync(tempDir, { mode: 0o700, recursive: true });
    return tempDir;
}

function cleanupDirectory(dirPath) {
    try {
        if (dirPath && fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    } catch (err) {
        // Log but don't throw - cleanup should not fail the response
        console.error('Cleanup warning:', err.message);
    }
}

app.post('/create-gif', upload.array('images'), async (req, res) => {
    let tempDir = null;
    
    try {
        // Validate images array
        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        if (req.files.length > 20) {
            return res.status(400).json({ error: 'Too many images' });
        }

        // Extract and validate parameters
        const { targetSize, delay = '10', appendReverted = 'false' } = req.body;

        if (!targetSize || !validateTargetSize(targetSize)) {
            return res.status(400).json({ 
                error: 'Invalid targetSize format. Use WIDTHxHEIGHT (e.g., 500x500)' 
            });
        }

        if (!validateDelay(delay)) {
            return res.status(400).json({ 
                error: 'Invalid delay. Must be between 1 and 5000 milliseconds' 
            });
        }

        // Create secure temporary directory
        tempDir = createSecureTempDir();
        const tempFiles = [];

        // Process uploaded files
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            
            // Validate file size
            if (!file.buffer || file.buffer.length === 0) {
                throw new Error('Empty file detected');
            }

            // Create safe filename
            const ext = path.extname(file.originalname || '').toLowerCase();
            const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
            const safeExt = allowedExts.includes(ext) ? ext : '.jpg';
            const fileName = `input_${i.toString().padStart(3, '0')}${safeExt}`;
            const filePath = path.join(tempDir, fileName);
            
            // Write file securely
            fs.writeFileSync(filePath, file.buffer, { mode: 0o600 });
            tempFiles.push(filePath);
        }

        // Prepare image sequence
        let imageSequence = [...tempFiles];
        
        // Handle appendReverted parameter
        const shouldAppendReverted = appendReverted === 'true' || appendReverted === true;
        if (shouldAppendReverted) {
            const reversedFiles = [...tempFiles].reverse();
            imageSequence = imageSequence.concat(reversedFiles);
        }

        // Output file path
        const outputPath = path.join(tempDir, 'output.gif');

        // Build ImageMagick arguments securely
        const convertArgs = [
            ...imageSequence,
            '-resize', targetSize,
            '-delay', delay.toString(),
            outputPath
        ];

        // Execute ImageMagick command safely
        execFileSync('convert', convertArgs, {
            cwd: tempDir,
            timeout: 30000, // 30 second timeout
            maxBuffer: 50 * 1024 * 1024, // 50MB max buffer
            stdio: 'pipe'
        });

        // Verify output was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('GIF generation failed');
        }

        // Read the generated GIF
        const gifBuffer = fs.readFileSync(outputPath);
        
        // Validate output size to prevent resource exhaustion
        if (gifBuffer.length > 50 * 1024 * 1024) {
            throw new Error('Generated GIF exceeds size limit');
        }

        // Send successful response
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Length', gifBuffer.length.toString());
        res.send(gifBuffer);

    } catch (error) {
        // Log error without exposing sensitive details
        console.error('GIF creation error:', error.message);
        
        // Return sanitized error messages
        if (error.code === 'ENOENT') {
            return res.status(500).json({ error: 'Image processing service unavailable' });
        } else if (error.killed || error.signal === 'SIGTERM') {
            return res.status(400).json({ error: 'Request timeout - images too large or complex' });
        } else if (error.message.includes('timeout')) {
            return res.status(400).json({ error: 'Processing timeout exceeded' });
        } else {
            return res.status(500).json({ error: 'Failed to create GIF' });
        }
    } finally {
        // Always cleanup temporary files
        if (tempDir) {
            cleanupDirectory(tempDir);
        }
    }
});

// Multer error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        switch (error.code) {
            case 'LIMIT_FILE_SIZE':
                return res.status(400).json({ error: 'File size exceeds limit' });
            case 'LIMIT_FILE_COUNT':
                return res.status(400).json({ error: 'Too many files uploaded' });
            case 'LIMIT_FIELD_VALUE':
                return res.status(400).json({ error: 'Form field value too large' });
            case 'LIMIT_PART_COUNT':
                return res.status(400).json({ error: 'Too many form parts' });
            default:
                return res.status(400).json({ error: 'File upload error' });
        }
    }
    
    if (error.message === 'Invalid file type') {
        return res.status(400).json({ error: 'Invalid file type. Only images allowed' });
    }
    
    // Log unexpected errors
    console.error('Unexpected error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`GIF Creator API running on ${HOST}:${PORT}`);
});