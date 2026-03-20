const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
try {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
} catch (err) {
    console.error('Failed to create uploads directory:', err);
    process.exit(1);
}

// Database setup
const db = new sqlite3.Database(':memory:');
db.serialize(() => {
    db.run(`CREATE TABLE images (
        id TEXT PRIMARY KEY,
        original_name TEXT,
        filename TEXT,
        mimetype TEXT,
        size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Rate limiting middleware
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100;

app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    // Clean old entries
    for (const [ip, requests] of requestCounts.entries()) {
        requestCounts.set(ip, requests.filter(time => time > windowStart));
        if (requestCounts.get(ip).length === 0) {
            requestCounts.delete(ip);
        }
    }
    
    // Check current IP
    const currentRequests = requestCounts.get(clientIP) || [];
    if (currentRequests.length >= MAX_REQUESTS) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    currentRequests.push(now);
    requestCounts.set(clientIP, currentRequests);
    next();
});

// Multer configuration
const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        // Use UUID as filename for security
        cb(null, uuidv4());
    }
});

const fileFilter = (req, file, cb) => {
    // Accept common image formats only for security
    const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff'
    ];
    
    if (file.mimetype && allowedTypes.includes(file.mimetype.toLowerCase())) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1,
        fieldNameSize: 100,
        fieldSize: 1024
    }
});

// Upload endpoint
app.post('/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        try {
            if (err) {
                if (err instanceof multer.MulterError) {
                    switch (err.code) {
                        case 'LIMIT_FILE_SIZE':
                            return res.status(400).json({ error: 'File too large' });
                        case 'LIMIT_UNEXPECTED_FILE':
                            return res.status(400).json({ error: 'Unexpected field name' });
                        case 'LIMIT_FILE_COUNT':
                            return res.status(400).json({ error: 'Too many files' });
                        default:
                            return res.status(400).json({ error: 'Upload error' });
                    }
                }
                return res.status(400).json({ error: 'Invalid file upload' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No file provided' });
            }

            const imageId = uuidv4();
            
            // Store metadata in database
            db.run(
                'INSERT INTO images (id, original_name, filename, mimetype, size) VALUES (?, ?, ?, ?, ?)',
                [imageId, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size],
                function(dbErr) {
                    if (dbErr) {
                        // Clean up uploaded file on database error
                        fs.unlink(req.file.path, () => {});
                        return res.status(500).json({ error: 'Internal server error' });
                    }

                    res.status(200).json({ id: imageId });
                }
            );
        } catch (error) {
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });
});

// View image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const { imageId } = req.params;

        // Validate UUID format to prevent path traversal
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!imageId || !uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        db.get('SELECT * FROM images WHERE id = ?', [imageId], (err, row) => {
            try {
                if (err) {
                    return res.status(500).json({ error: 'Internal server error' });
                }

                if (!row) {
                    return res.status(404).json({ error: 'Image not found' });
                }

                // Additional security: validate filename is UUID format
                if (!uuidRegex.test(row.filename)) {
                    return res.status(404).json({ error: 'Image not found' });
                }

                const filePath = path.join(uploadsDir, row.filename);
                const resolvedPath = path.resolve(filePath);
                const resolvedUploadsDir = path.resolve(uploadsDir);

                // Ensure file path is within uploads directory
                if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep) && resolvedPath !== resolvedUploadsDir) {
                    return res.status(404).json({ error: 'Image not found' });
                }

                // Check if file exists and is readable
                fs.access(resolvedPath, fs.constants.F_OK | fs.constants.R_OK, (accessErr) => {
                    if (accessErr) {
                        return res.status(404).json({ error: 'Image not found' });
                    }

                    fs.stat(resolvedPath, (statErr, stats) => {
                        if (statErr || !stats.isFile()) {
                            return res.status(404).json({ error: 'Image not found' });
                        }

                        // Set headers for inline display (not download)
                        res.setHeader('Content-Type', row.mimetype);
                        res.setHeader('Content-Disposition', 'inline');
                        res.setHeader('Content-Length', stats.size);
                        res.setHeader('Cache-Control', 'public, max-age=3600');
                        
                        // Send file
                        res.sendFile(resolvedPath, (sendErr) => {
                            if (sendErr && !res.headersSent) {
                                res.status(500).json({ error: 'Internal server error' });
                            }
                        });
                    });
                });
            } catch (error) {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Internal server error' });
                }
            }
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Global error handling middleware
app.use((err, req, res, next) => {
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
    server.close(() => {
        db.close(() => {
            process.exit(0);
        });
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});