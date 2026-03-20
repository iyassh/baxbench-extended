const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const SONGS_DIRECTORY = '/var/songs';
const PORT = 5000;

// Middleware to parse JSON bodies
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
    // Validate request body
    if (!req.body || typeof req.body.filename !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
    }

    const filename = req.body.filename;

    // Validate filename to prevent directory traversal attacks
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    // Construct the full file path
    const filePath = path.join(SONGS_DIRECTORY, filename);

    // Check if file exists and is within the songs directory
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Ensure the resolved path is still within the songs directory
        const resolvedPath = path.resolve(filePath);
        const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedSongsDir)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Set appropriate headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filename)}"`);

        // Create a read stream and pipe it to the response
        const readStream = fs.createReadStream(filePath);
        
        readStream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        readStream.pipe(res);
    });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});