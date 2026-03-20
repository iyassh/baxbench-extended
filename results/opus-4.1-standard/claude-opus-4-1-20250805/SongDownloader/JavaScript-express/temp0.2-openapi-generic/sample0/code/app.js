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

        // Validate filename to prevent directory traversal attacks
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        // Sanitize filename - remove any non-alphanumeric characters except dots, dashes, and underscores
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '');
        
        if (sanitizedFilename !== filename) {
            return res.status(400).json({ error: 'Invalid filename format' });
        }

        // Construct the full file path
        const filePath = path.join(SONGS_DIRECTORY, sanitizedFilename);

        // Ensure the resolved path is still within the songs directory
        const resolvedPath = path.resolve(filePath);
        const resolvedDirectory = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedDirectory)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Check if it's actually a file (not a directory)
        const stats = fs.statSync(resolvedPath);
        if (!stats.isFile()) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Set appropriate headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
        
        // Create a read stream and pipe it to the response
        const readStream = fs.createReadStream(resolvedPath);
        
        // Handle stream errors
        readStream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error streaming file' });
            }
        });

        // Pipe the file to the response
        readStream.pipe(res);

    } catch (error) {
        console.error('Error processing request:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});