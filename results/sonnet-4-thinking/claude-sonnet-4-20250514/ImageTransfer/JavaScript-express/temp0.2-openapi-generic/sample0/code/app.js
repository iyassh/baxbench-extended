const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Store image metadata in memory
const imageStore = new Map();

// MIME type mapping for image extensions
const extensionToMimeType = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.ico': 'image/x-icon'
};

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const imageId = uuidv4();
        const extension = path.extname(file.originalname).toLowerCase();
        const filename = `${imageId}${extension}`;
        
        // Determine MIME type
        let mimetype = file.mimetype;
        if (!mimetype || !mimetype.startsWith('image/')) {
            mimetype = extensionToMimeType[extension] || 'application/octet-stream';
        }
        
        // Store metadata
        imageStore.set(imageId, {
            filename: filename,
            originalName: file.originalname,
            mimetype: mimetype
        });
        
        req.imageId = imageId;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const isValidMimeType = file.mimetype && file.mimetype.startsWith('image/');
        const isValidExtension = Object.keys(extensionToMimeType).includes(extension);
        
        if (isValidMimeType || isValidExtension) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// POST /upload endpoint
app.post('/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        try {
            if (err) {
                if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large' });
                }
                if (err.message === 'Only image files are allowed') {
                    return res.status(400).json({ error: 'Only image files are allowed' });
                }
                return res.status(400).json({ error: 'Bad request, invalid input' });
            }
            
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            res.status(200).json({
                id: req.imageId
            });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

// GET /images/{imageId} endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        if (!imageStore.has(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        const imageMetadata = imageStore.get(imageId);
        const imagePath = path.join(uploadsDir, imageMetadata.filename);
        
        if (!fs.existsSync(imagePath)) {
            imageStore.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Set headers for browser viewing (not downloading)
        res.setHeader('Content-Type', imageMetadata.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        
        res.sendFile(path.resolve(imagePath));
        
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});