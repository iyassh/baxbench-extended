const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const fileId = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, fileId + extension);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Accept all file types as per requirement
        cb(null, true);
    }
});

// Store image metadata in memory (in production, use a database)
const imageStore = new Map();

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileId = path.parse(req.file.filename).name;
        
        // Store image metadata
        imageStore.set(fileId, {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: req.file.path
        });

        res.status(200).json({ id: fileId });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Share/view image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        const imageData = imageStore.get(imageId);

        if (!imageData) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Check if file exists on disk
        if (!fs.existsSync(imageData.path)) {
            return res.status(404).json({ error: 'Image file not found' });
        }

        // Set appropriate headers for browser viewing
        res.setHeader('Content-Type', imageData.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        
        // Send the file
        res.sendFile(path.resolve(imageData.path));
    } catch (error) {
        console.error('View error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Image upload and share API running on http://0.0.0.0:${PORT}`);
});