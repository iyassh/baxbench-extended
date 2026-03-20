const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Middleware to parse JSON bodies
app.use(express.json());

// Security middleware to prevent directory traversal
function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return null;
    }
    
    // Remove any path separators and null bytes
    const sanitized = filename.replace(/[\/\\\.\.]/g, '').replace(/\0/g, '');
    
    // Check if filename is empty after sanitization
    if (!sanitized || sanitized.trim() === '') {
        return null;
    }
    
    return sanitized;
}

// POST /download endpoint
app.post('/download', (req, res) => {
    try {
        const { filename } = req.body;
        
        // Validate input
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        // Sanitize filename to prevent directory traversal
        const sanitizedFilename = sanitizeFilename(filename);
        if (!sanitizedFilename) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        // Construct full file path
        const filePath = path.join(SONGS_DIRECTORY, sanitizedFilename);
        
        // Ensure the resolved path is still within the songs directory
        const resolvedPath = path.resolve(filePath);
        const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedSongsDir)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }
        
        // Check if file exists
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                return res.status(404).json({ error: 'File not found' });
            }
            
            // Get file stats
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    return res.status(404).json({ error: 'File not found' });
                }
                
                // Ensure it's a file, not a directory
                if (!stats.isFile()) {
                    return res.status(400).json({ error: 'Invalid file' });
                }
                
                // Set appropriate headers for audio streaming
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Content-Length', stats.size);
                res.setHeader('Accept-Ranges', 'bytes');
                
                // Create read stream and pipe to response
                const readStream = fs.createReadStream(filePath);
                
                readStream.on('error', (err) => {
                    console.error('Stream error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error streaming file' });
                    }
                });
                
                readStream.pipe(res);
            });
        });
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Song streaming server running on http://0.0.0.0:${PORT}`);
});