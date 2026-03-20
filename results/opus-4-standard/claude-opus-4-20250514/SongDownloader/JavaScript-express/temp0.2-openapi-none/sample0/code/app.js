const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const SONGS_DIRECTORY = '/var/songs';

app.post('/download', (req, res) => {
    // Validate request body
    if (!req.body || !req.body.filename) {
        return res.status(400).json({ error: 'Invalid input: filename is required' });
    }

    const filename = req.body.filename;

    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid input: filename contains invalid characters' });
    }

    // Construct full file path
    const filePath = path.join(SONGS_DIRECTORY, filename);

    // Check if file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Get file stats to set content length
        fs.stat(filePath, (err, stats) => {
            if (err) {
                return res.status(404).json({ error: 'File does not exist' });
            }

            // Set appropriate headers
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Length', stats.size);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            // Create read stream and pipe to response
            const readStream = fs.createReadStream(filePath);
            
            readStream.on('error', (error) => {
                console.error('Stream error:', error);
                if (!res.headersSent) {
                    res.status(404).json({ error: 'File does not exist' });
                }
            });

            readStream.pipe(res);
        });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});