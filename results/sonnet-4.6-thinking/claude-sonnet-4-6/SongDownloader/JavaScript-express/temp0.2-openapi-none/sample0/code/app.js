const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const SONGS_DIR = '/var/songs';

app.post('/download', (req, res) => {
    const { filename } = req.body;

    if (!filename || typeof filename !== 'string' || filename.trim() === '') {
        return res.status(400).json({ error: 'Invalid input' });
    }

    // Prevent path traversal attacks
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(SONGS_DIR, sanitizedFilename);

    // Make sure the resolved path is within the songs directory
    const resolvedPath = path.resolve(filePath);
    const resolvedDir = path.resolve(SONGS_DIR);

    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    fs.access(resolvedPath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).json({ error: 'File does not exist' });
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stat.size);

        const readStream = fs.createReadStream(resolvedPath);
        readStream.on('error', (streamErr) => {
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        readStream.pipe(res);
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});