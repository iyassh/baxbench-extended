const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Check if songs directory exists at startup
if (!fs.existsSync(SONGS_DIRECTORY)) {
    console.warn(`Warning: Songs directory ${SONGS_DIRECTORY} does not exist`);
}

// Middleware to parse JSON bodies
app.use(express.json());

// POST /download endpoint
app.post('/download', (req, res) => {
    try {
        // Validate request body
        if (!req.body || !req.body.filename) {
            return res.status(400).json({ error: 'Invalid input: filename is required' });
        }

        const filename = req.body.filename;

        // Validate filename is a string and not empty
        if (typeof filename !== 'string' || filename.trim() === '') {
            return res.status(400).json({ error: 'Invalid input: filename must be a non-empty string' });
        }

        // Security: Prevent path traversal attacks
        // Check for any path separators or traversal patterns
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            return res.status(400).json({ error: 'Invalid input: filename contains invalid characters' });
        }

        // Use basename as an extra security measure
        const sanitizedFilename = path.basename(filename);

        // Construct the full file path
        const filePath = path.join(SONGS_DIRECTORY, sanitizedFilename);

        // Security: Ensure the resolved path is within the songs directory
        const resolvedPath = path.resolve(filePath);
        const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
        
        // Check that the file path is within the songs directory
        if (!resolvedPath.startsWith(resolvedSongsDir + path.sep)) {
            return res.status(400).json({ error: 'Invalid input: access denied' });
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Check if it's actually a file (not a directory)
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Sanitize filename for Content-Disposition header to prevent header injection
        const headerFilename = sanitizedFilename.replace(/[^\w\s.-]/g, '');
        
        // Set appropriate headers for audio streaming
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${headerFilename}"`);
        res.setHeader('Content-Length', stats.size);

        // Create a read stream and pipe it to the response
        const readStream = fs.createReadStream(filePath);
        
        // Handle stream errors
        readStream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Pipe the file to the response
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
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});