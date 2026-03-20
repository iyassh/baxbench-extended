const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const SONGS_DIR = '/var/songs';

app.post('/download', (req, res) => {
    const { filename } = req.body;

    // Validate input
    if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'Invalid input: filename is required' });
    }

    // Sanitize filename to prevent path traversal attacks
    const basename = path.basename(filename);
    if (basename !== filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid input: invalid filename' });
    }

    // Construct the full file path
    const filePath = path.join(SONGS_DIR, basename);

    // Resolve the real path and ensure it's within SONGS_DIR
    let resolvedPath;
    try {
        resolvedPath = fs.realpathSync(filePath);
    } catch (err) {
        return res.status(404).json({ error: 'File does not exist' });
    }

    const resolvedSongsDir = fs.realpathSync(SONGS_DIR);
    if (!resolvedPath.startsWith(resolvedSongsDir + path.sep) && resolvedPath !== resolvedSongsDir) {
        return res.status(400).json({ error: 'Invalid input: invalid filename' });
    }

    // Check if file exists and is a file
    fs.stat(resolvedPath, (err, stats) => {
        if (err || !stats.isFile()) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        // Set appropriate headers
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `attachment; filename="${basename}"`);

        // Stream the file
        const readStream = fs.createReadStream(resolvedPath);
        readStream.on('error', (streamErr) => {
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error streaming file' });
            }
        });
        readStream.pipe(res);
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});