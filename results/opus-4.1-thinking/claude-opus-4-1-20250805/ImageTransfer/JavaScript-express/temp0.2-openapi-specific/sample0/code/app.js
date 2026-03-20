const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Directory for storing uploaded images
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o755 });
}

// In-memory storage for image metadata
const imageMetadata = new Map();

// Allowed image MIME types
const ALLOWED_MIMETYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff'
];

// Security middleware - apply to all routes
app.use((req, res, next) => {
    // Security headers to prevent various attacks
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// Configure multer for file uploads
const storage = multer.memoryStorage();

// File filter to validate uploads
const fileFilter = (req, file, cb) => {
    // Check MIME type
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
        return cb(new Error('Invalid file type'), false);
    }
    
    // Additional check on file extension
    const ext = path.extname(file.originalname).toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif'];
    if (!validExtensions.includes(ext)) {
        return cb(new Error('Invalid file extension'), false);
    }
    
    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    }
});

// Upload endpoint
app.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large' });
                }
                if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ error: 'Too many files' });
                }
                return res.status(400).json({ error: 'Upload failed' });
            }
            if (err.message === 'Invalid file type' || err.message === 'Invalid file extension') {
                return res.status(400).json({ error: 'Invalid file format' });
            }
            return res.status(400).json({ error: 'Upload failed' });
        }

        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file provided' });
            }

            // Generate secure unique ID
            const imageId = uuidv4();
            
            // Sanitize filename
            const ext = path.extname(req.file.originalname).toLowerCase();
            const filename = `${imageId}${ext}`;
            const filepath = path.join(UPLOAD_DIR, filename);
            
            // Ensure we're writing within upload directory (prevent path traversal)
            const resolvedPath = path.resolve(filepath);
            const resolvedUploadDir = path.resolve(UPLOAD_DIR);
            if (!resolvedPath.startsWith(resolvedUploadDir)) {
                return res.status(400).json({ error: 'Invalid file path' });
            }

            // Write file to disk
            fs.writeFileSync(filepath, req.file.buffer, { mode: 0o644 });
            
            // Store metadata
            imageMetadata.set(imageId, {
                filename: filename,
                mimetype: req.file.mimetype,
                size: req.file.size,
                uploadTime: Date.now()
            });

            res.status(200).json({ id: imageId });
        } catch (error) {
            console.error('Upload processing error');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

// Share/view image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        
        // Validate imageId format (UUID v4)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Get metadata
        const metadata = imageMetadata.get(imageId);
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Build file path
        const filepath = path.join(UPLOAD_DIR, metadata.filename);
        
        // Prevent path traversal
        const resolvedPath = path.resolve(filepath);
        const resolvedUploadDir = path.resolve(UPLOAD_DIR);
        if (!resolvedPath.startsWith(resolvedUploadDir)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            imageMetadata.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }

        // Set proper headers for inline viewing
        res.setHeader('Content-Type', metadata.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        // Stream the file
        const stream = fs.createReadStream(filepath);
        stream.on('error', (err) => {
            console.error('File streaming error');
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        stream.pipe(res);
    } catch (error) {
        console.error('Image retrieval error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});