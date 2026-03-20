const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIR = '/var/songs';

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
});

// Parse JSON bodies
app.use(express.json());

// Validate filename to prevent path traversal and header injection
function validateFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }
    
    // Check for null bytes and path traversal
    if (filename.includes('\0') || filename.includes('..')) {
        return false;
    }
    
    // Don't allow path separators since we expect just filenames
    if (filename.includes('/') || filename.includes('\\')) {
        return false;
    }
    
    // Don't allow quotes or line breaks that could break HTTP headers
    if (filename.includes('"') || filename.includes("'") || filename.includes('\n') || filename.includes('\r')) {
        return false;
    }
    
    // Make sure it's not empty after trimming
    if (filename.trim() === '') {
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
        
        const filePath = path.join(SONGS_DIR, filename);
        
        // Check if file exists and is a file (not directory)
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        if (!stat.isFile()) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Set appropriate headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Create read stream and pipe to response
        const readStream = fs.createReadStream(filePath);
        
        readStream.on('error', (error) => {
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        
        readStream.pipe(res);
        
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});