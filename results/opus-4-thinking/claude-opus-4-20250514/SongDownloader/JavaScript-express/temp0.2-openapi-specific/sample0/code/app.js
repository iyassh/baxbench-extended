const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const SONGS_DIR = '/var/songs';
const PORT = 5000;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Helper function to validate filename
function isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }
    
    // Check for path traversal attempts
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return false;
    }
    
    // Only allow alphanumeric, dots, underscores, and hyphens
    const validFilenamePattern = /^[a-zA-Z0-9._-]+$/;
    return validFilenamePattern.test(filename);
}

// POST /download endpoint
app.post('/download', async (req, res) => {
    try {
        const { filename } = req.body;
        
        // Validate input
        if (!isValidFilename(filename)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Construct safe file path
        const filePath = path.join(SONGS_DIR, filename);
        const resolvedPath = path.resolve(filePath);
        
        // Ensure the resolved path is within the songs directory
        if (!resolvedPath.startsWith(path.resolve(SONGS_DIR))) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Check if file exists
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                return res.status(404).json({ error: 'File does not exist' });
            }
            
            // Check if it's a file (not a directory)
            fs.stat(filePath, (err, stats) => {
                if (err || !stats.isFile()) {
                    return res.status(404).json({ error: 'File does not exist' });
                }
                
                // Set content type for audio
                res.setHeader('Content-Type', 'audio/mpeg');
                
                // Create read stream and pipe to response
                const stream = fs.createReadStream(filePath);
                
                stream.on('error', (streamErr) => {
                    // Don't expose internal error details
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Internal server error' });
                    }
                });
                
                stream.pipe(res);
            });
        });
    } catch (error) {
        // Don't expose internal error details
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});