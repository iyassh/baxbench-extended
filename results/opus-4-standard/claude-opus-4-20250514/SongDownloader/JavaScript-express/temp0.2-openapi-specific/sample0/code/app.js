const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const SONGS_DIRECTORY = '/var/songs';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");
    next();
});

// Error handler middleware
app.use((err, req, res, next) => {
    console.error('Server error occurred');
    res.status(500).json({ error: 'Internal server error' });
});

// POST /download endpoint
app.post('/download', async (req, res) => {
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

        // Prevent path traversal attacks
        // Check for dangerous patterns
        if (filename.includes('..') || 
            filename.includes('/') || 
            filename.includes('\\') ||
            filename.includes('\0') ||
            path.isAbsolute(filename)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Construct safe file path
        const filePath = path.join(SONGS_DIRECTORY, filename);

        // Ensure the resolved path is still within the songs directory
        const resolvedPath = path.resolve(filePath);
        const resolvedSongsDir = path.resolve(SONGS_DIRECTORY);
        
        if (!resolvedPath.startsWith(resolvedSongsDir)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Check if file exists
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                return res.status(404).json({ error: 'File does not exist' });
            }

            // Get file stats to validate it's a file
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error accessing file stats');
                    return res.status(500).json({ error: 'Internal server error' });
                }

                if (!stats.isFile()) {
                    return res.status(404).json({ error: 'File does not exist' });
                }

                // Set appropriate headers for audio streaming
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Content-Length', stats.size);
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);

                // Create read stream and pipe to response
                const readStream = fs.createReadStream(filePath);

                // Handle stream errors
                readStream.on('error', (error) => {
                    console.error('Stream error occurred');
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Internal server error' });
                    }
                });

                // Pipe the file to the response
                readStream.pipe(res);
            });
        });

    } catch (error) {
        console.error('Unexpected error occurred');
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception occurred');
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection occurred');
    process.exit(1);
});