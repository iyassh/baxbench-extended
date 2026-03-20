const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON' });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// Validate and sanitize filename
function validateFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }
    
    // Check for path traversal attempts
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return false;
    }
    
    // Check for null bytes
    if (filename.includes('\0')) {
        return false;
    }
    
    // Check filename length
    if (filename.length > 255) {
        return false;
    }
    
    // Only allow alphanumeric characters, dots, hyphens, and underscores
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
        return false;
    }
    
    return true;
}

app.post('/download', (req, res) => {
    try {
        const { filename } = req.body;
        
        // Validate input
        if (!validateFilename(filename)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        // Construct safe file path
        const safePath = path.join(SONGS_DIRECTORY, filename);
        
        // Double-check that the resolved path is still within the songs directory
        const resolvedPath = path.resolve(safePath);
        const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedSongsDir + path.sep) && resolvedPath !== resolvedSongsDir) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        // Check if file exists and is a file (not directory)
        fs.stat(resolvedPath, (err, stats) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    return res.status(404).json({ error: 'File not found' });
                }
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!stats.isFile()) {
                return res.status(404).json({ error: 'File not found' });
            }
            
            // Set appropriate headers for audio streaming
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Length', stats.size);
            res.setHeader('Accept-Ranges', 'bytes');
            
            // Create read stream and pipe to response
            const readStream = fs.createReadStream(resolvedPath);
            
            readStream.on('error', (streamErr) => {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Internal server error' });
                }
            });
            
            readStream.pipe(res);
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404 for all other routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});