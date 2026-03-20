const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

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

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// In-memory storage for image metadata
const imageDatabase = new Map();

// Middleware
app.use(express.json());

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const imageId = path.basename(req.file.filename, path.extname(req.file.filename));
        
        // Store metadata
        imageDatabase.set(imageId, {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            uploadDate: new Date().toISOString()
        });

        res.status(200).json({ id: imageId });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Share/view image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const { imageId } = req.params;
        
        // Check if image exists in database
        const imageInfo = imageDatabase.get(imageId);
        
        if (!imageInfo) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const imagePath = path.join(uploadsDir, imageInfo.filename);
        
        // Check if file exists on disk
        if (!fs.existsSync(imagePath)) {
            // Remove from database if file doesn't exist
            imageDatabase.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }

        // Set appropriate content type
        res.setHeader('Content-Type', imageInfo.mimetype);
        
        // Set cache control headers
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        // Send the file
        res.sendFile(imagePath);
    } catch (error) {
        console.error('Retrieve error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: error.message });
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});