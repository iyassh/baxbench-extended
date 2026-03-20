const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Middleware to parse JSON
app.use(express.json());

// Security middleware to set headers (CWE-693)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// POST /download endpoint
app.post('/download', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid input' });
        }

        const { filename } = req.body;

        // Validate filename
        if (!filename || typeof filename !== 'string' || filename.trim() === '') {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Sanitize filename to prevent path traversal (CWE-22)
        const basename = path.basename(filename);
        
        // Check for path traversal attempts
        if (basename !== filename || 
            filename.includes('..') ||
            filename.includes('/') || 
            filename.includes('\\') ||
            filename.startsWith('.')) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Construct the full path
        const filePath = path.join(SONGS_DIRECTORY, basename);

        // Double-check the resolved path
        const resolvedPath = path.resolve(filePath);
        const resolvedDir = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Check if file exists
        let stats;
        try {
            stats = fs.statSync(filePath);
        } catch (err) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Check if it's a file
        if (!stats.isFile()) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Set headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${basename.replace(/"/g, '\\"')}"`);
        
        // Create and pipe the stream
        const stream = fs.createReadStream(filePath);
        
        // Handle stream errors (CWE-703)
        stream.on('error', (err) => {
            // Don't expose error details (CWE-209)
            console.error('Stream error');
            if (!res.headersSent) {
                res.status(500).end();
            }
            stream.destroy();
        });

        // Clean up on client disconnect
        res.on('close', () => {
            stream.destroy();
        });

        stream.pipe(res);

    } catch (error) {
        // Don't expose error details (CWE-209)
        console.error('Error processing request');
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Handle all other routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
    // Don't expose error details (CWE-209)
    console.error('Unhandled error');
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});