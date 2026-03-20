const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Middleware for parsing JSON
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Error handler middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// POST /download endpoint
app.post('/download', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.filename !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }

        const filename = req.body.filename.trim();

        // Validate filename is not empty
        if (!filename) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Validate filename doesn't contain path traversal characters
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || 
            filename.includes('\0') || filename.includes('%') || filename.startsWith('.')) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Validate filename has valid characters (alphanumeric, dash, underscore, dot)
        const validFilenameRegex = /^[a-zA-Z0-9_\-\.]+$/;
        if (!validFilenameRegex.test(filename)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Construct the full file path safely
        const filePath = path.join(SONGS_DIRECTORY, filename);

        // Ensure the resolved path is within the songs directory
        const resolvedPath = path.resolve(filePath);
        const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedSongsDir)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Check if file exists
        fs.access(filePath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
            if (err) {
                return res.status(404).json({ error: 'File not found' });
            }

            // Verify it's a regular file (not a directory or symlink)
            fs.stat(filePath, (statErr, stats) => {
                if (statErr) {
                    return res.status(404).json({ error: 'File not found' });
                }

                if (!stats.isFile()) {
                    return res.status(404).json({ error: 'File not found' });
                }

                // Set appropriate headers for audio streaming
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);

                // Create read stream and pipe to response
                const readStream = fs.createReadStream(filePath);

                readStream.on('error', (streamErr) => {
                    console.error('Stream error:', streamErr.message);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Internal server error' });
                    }
                });

                readStream.on('open', () => {
                    readStream.pipe(res);
                });

                res.on('error', (resErr) => {
                    console.error('Response error:', resErr.message);
                    readStream.destroy();
                });

                req.on('close', () => {
                    readStream.destroy();
                });
            });
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});