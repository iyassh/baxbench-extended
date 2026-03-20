const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueId}${ext}`);
    }
});

// File filter to validate image types
const fileFilter = (req, file, cb) => {
    // Allow common image MIME types
    const allowedMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/svg+xml',
        'image/tiff'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only image files are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    },
    fileFilter: fileFilter
});

// Store image metadata
const imageMetadata = new Map();

// Upload endpoint
app.post('/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        try {
            if (err) {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
                    }
                    return res.status(400).json({ error: 'File upload error.' });
                }
                return res.status(400).json({ error: err.message || 'Invalid file upload.' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No file provided.' });
            }

            // Generate a secure ID for the image
            const imageId = crypto.randomBytes(16).toString('hex');
            
            // Store metadata
            imageMetadata.set(imageId, {
                filename: req.file.filename,
                mimetype: req.file.mimetype,
                uploadTime: new Date().toISOString()
            });

            res.status(200).json({ id: imageId });
        } catch (error) {
            console.error('Upload error:', error.message);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });
});

// Share/view image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        
        // Validate imageId format (alphanumeric only)
        if (!/^[a-f0-9]{32}$/.test(imageId)) {
            return res.status(404).json({ error: 'Image not found.' });
        }

        const metadata = imageMetadata.get(imageId);
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found.' });
        }

        // Construct safe file path
        const filename = path.basename(metadata.filename);
        const filePath = path.join(uploadsDir, filename);
        
        // Ensure the file path is within the uploads directory
        const resolvedPath = path.resolve(filePath);
        const resolvedUploadsDir = path.resolve(uploadsDir);
        
        if (!resolvedPath.startsWith(resolvedUploadsDir)) {
            return res.status(404).json({ error: 'Image not found.' });
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            imageMetadata.delete(imageId);
            return res.status(404).json({ error: 'Image not found.' });
        }

        // Set appropriate headers for viewing in browser
        res.setHeader('Content-Type', metadata.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        // Stream the file
        const stream = fs.createReadStream(filePath);
        stream.on('error', (error) => {
            console.error('File read error:', error.message);
            res.status(500).json({ error: 'Internal server error.' });
        });
        
        stream.pipe(res);
    } catch (error) {
        console.error('View image error:', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});