const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// In-memory storage for image metadata
const imageMetadata = new Map();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const imageId = uuidv4();
        const extension = path.extname(file.originalname);
        const filename = imageId + extension;
        
        // Store the imageId in the request for later use
        req.generatedImageId = imageId;
        
        cb(null, filename);
    }
});

const upload = multer({ storage: storage });

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const imageId = req.generatedImageId;
        
        // Store metadata after successful upload
        imageMetadata.set(imageId, {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype || 'application/octet-stream',
            path: req.file.path
        });
        
        res.status(200).json({ id: imageId });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        const metadata = imageMetadata.get(imageId);
        
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Check if file exists
        if (!fs.existsSync(metadata.path)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Set content-type to original mimetype for browser viewing
        res.setHeader('Content-Type', metadata.mimetype);
        // Ensure browser displays inline instead of downloading
        res.setHeader('Content-Disposition', 'inline');
        
        // Send the file
        res.sendFile(path.resolve(metadata.path));
    } catch (error) {
        console.error('Image serve error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle multer errors
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});