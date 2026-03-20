const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads with security restrictions
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Generate secure filename to prevent path traversal
        const safeFilename = uuidv4() + '.tmp';
        cb(null, safeFilename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 50 // Maximum 50 files
    },
    fileFilter: (req, file, cb) => {
        // Only allow image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images are allowed.'));
        }
    }
});

// Cleanup function to remove temporary files
function cleanupFiles(files) {
    files.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (err) {
            console.error('Error cleaning up file:', err.message);
        }
    });
}

// Validate target size format
function validateTargetSize(targetSize) {
    if (!targetSize || typeof targetSize !== 'string') {
        return false;
    }
    
    const sizeRegex = /^(\d{1,4})x(\d{1,4})$/;
    const match = targetSize.match(sizeRegex);
    
    if (!match) {
        return false;
    }
    
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    
    // Reasonable size limits
    if (width < 1 || width > 2000 || height < 1 || height > 2000) {
        return false;
    }
    
    return true;
}

// Validate delay parameter
function validateDelay(delay) {
    const delayNum = parseInt(delay);
    return !isNaN(delayNum) && delayNum >= 1 && delayNum <= 10000;
}

app.post('/create-gif', upload.array('images', 50), async (req, res) => {
    const tempFiles = [];
    
    try {
        // Validate required fields
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        if (req.files.length > 50) {
            cleanupFiles(req.files.map(f => f.path));
            return res.status(400).json({ error: 'Too many images. Maximum 50 allowed.' });
        }
        
        const { targetSize, delay = '10', appendReverted = 'false' } = req.body;
        
        if (!validateTargetSize(targetSize)) {
            cleanupFiles(req.files.map(f => f.path));
            return res.status(400).json({ error: 'Invalid target size format. Use format like 500x500 with dimensions between 1-2000.' });
        }
        
        if (!validateDelay(delay)) {
            cleanupFiles(req.files.map(f => f.path));
            return res.status(400).json({ error: 'Invalid delay. Must be between 1 and 10000 milliseconds.' });
        }
        
        const delayValue = parseInt(delay);
        const shouldAppendReverted = appendReverted === 'true';
        
        // Add uploaded files to temp files list for cleanup
        tempFiles.push(...req.files.map(f => f.path));
        
        // Generate unique output filename
        const outputFilename = uuidv4() + '.gif';
        const outputPath = path.join(uploadsDir, outputFilename);
        tempFiles.push(outputPath);
        
        // Prepare ImageMagick command arguments
        const args = [];
        
        // Add input files
        req.files.forEach(file => {
            args.push(file.path);
        });
        
        // If appendReverted is true, add files in reverse order (excluding the last one to avoid duplication)
        if (shouldAppendReverted && req.files.length > 1) {
            for (let i = req.files.length - 2; i >= 0; i--) {
                args.push(req.files[i].path);
            }
        }
        
        // Add ImageMagick options
        args.push('-resize', targetSize);
        args.push('-delay', Math.floor(delayValue / 10).toString()); // ImageMagick delay is in centiseconds
        args.push('-loop', '0');
        args.push(outputPath);
        
        // Execute ImageMagick convert command
        execFile('convert', args, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('ImageMagick error:', error.message);
                cleanupFiles(tempFiles);
                return res.status(500).json({ error: 'Failed to create GIF' });
            }
            
            // Check if output file was created
            if (!fs.existsSync(outputPath)) {
                cleanupFiles(tempFiles);
                return res.status(500).json({ error: 'Failed to create GIF' });
            }
            
            // Send the GIF file
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Content-Disposition', 'attachment; filename="animated.gif"');
            
            const fileStream = fs.createReadStream(outputPath);
            
            fileStream.on('error', (err) => {
                console.error('File stream error:', err.message);
                cleanupFiles(tempFiles);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to send GIF' });
                }
            });
            
            fileStream.on('end', () => {
                // Clean up temporary files after sending
                setTimeout(() => cleanupFiles(tempFiles), 1000);
            });
            
            fileStream.pipe(res);
        });
        
    } catch (error) {
        console.error('Unexpected error:', error.message);
        cleanupFiles(tempFiles);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error.message);
    
    // Clean up any uploaded files
    if (req.files) {
        cleanupFiles(req.files.map(f => f.path));
    }
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 10MB per file.' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum 50 files allowed.' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }
    
    if (error.message === 'Invalid file type. Only images are allowed.') {
        return res.status(400).json({ error: 'Invalid file type. Only images are allowed.' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Periodic cleanup of old temporary files
setInterval(() => {
    try {
        const files = fs.readdirSync(uploadsDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            try {
                const stats = fs.statSync(filePath);
                // Remove files older than 1 hour
                if (now - stats.mtime.getTime() > 3600000) {
                    fs.unlinkSync(filePath);
                }
            } catch (err) {
                // File might have been deleted already
            }
        });
    } catch (err) {
        console.error('Cleanup error:', err.message);
    }
}, 300000); // Run every 5 minutes

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});