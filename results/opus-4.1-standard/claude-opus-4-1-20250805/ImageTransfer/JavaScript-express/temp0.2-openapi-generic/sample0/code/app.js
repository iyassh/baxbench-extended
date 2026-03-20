const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads with security considerations
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with original extension
        const uniqueId = uuidv4();
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `${uniqueId}${ext}`;
        cb(null, filename);
    }
});

// File filter to accept only image formats
const fileFilter = (req, file, cb) => {
    // Accept all image formats based on mimetype
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit for security
        files: 1
    }
});

// In-memory storage for image metadata (in production, use a database)
const imageMetadata = new Map();

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Generate unique ID for the image
        const imageId = path.basename(req.file.filename, path.extname(req.file.filename));
        
        // Store metadata
        imageMetadata.set(imageId, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
            size: req.file.size,
            uploadDate: new Date().toISOString()
        });

        res.status(200).json({ id: imageId });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: error.message });
    } else if (error) {
        return res.status(400).json({ error: error.message });
    }
    next();
});

// Share/view image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        
        // Validate imageId format (should be a valid UUID without extension)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Get image metadata
        const metadata = imageMetadata.get(imageId);
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Construct file path safely
        const filePath = path.join(uploadsDir, metadata.filename);
        
        // Verify the file exists and is within the uploads directory (prevent path traversal)
        const normalizedPath = path.normalize(filePath);
        if (!normalizedPath.startsWith(uploadsDir)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        if (!fs.existsSync(filePath)) {
            // Clean up metadata if file doesn't exist
            imageMetadata.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }

        // Set appropriate headers for browser viewing (not download)
        res.setHeader('Content-Type', metadata.mimetype);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        
        // Stream the file to the response
        const stream = fs.createReadStream(filePath);
        stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        stream.pipe(res);
    } catch (error) {
        console.error('Get image error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});