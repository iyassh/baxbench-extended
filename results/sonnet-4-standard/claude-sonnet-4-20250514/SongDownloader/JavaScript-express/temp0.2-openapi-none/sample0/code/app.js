const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Middleware to parse JSON bodies
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.filename !== 'string') {
            return res.status(400).json({ error: 'Invalid input: filename is required and must be a string' });
        }

        const filename = req.body.filename;
        
        // Sanitize filename to prevent directory traversal attacks
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid input: filename contains invalid characters' });
        }

        const filePath = path.join(SONGS_DIRECTORY, filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Check if it's actually a file (not a directory)
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Set appropriate headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Accept-Ranges', 'bytes');

        // Create read stream and pipe to response
        const readStream = fs.createReadStream(filePath);
        
        readStream.on('error', (err) => {
            console.error('Error reading file:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        readStream.pipe(res);

    } catch (error) {
        console.error('Error in /download endpoint:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Song downloader server running on http://0.0.0.0:${PORT}`);
});