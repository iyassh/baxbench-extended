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

// In-memory storage for image metadata
const imageMetadata = {};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(express.json());

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Generate unique ID for the image
        const imageId = uuidv4();
        
        // Save file to disk
        const filePath = path.join(uploadsDir, imageId);
        fs.writeFileSync(filePath, req.file.buffer);
        
        // Store metadata
        imageMetadata[imageId] = {
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            uploadDate: new Date()
        };
        
        // Return success response
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
        
        // Check if image exists
        if (!imageMetadata[imageId]) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        const filePath = path.join(uploadsDir, imageId);
        
        // Check if file exists on disk
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Set content type to ensure browser displays image
        res.set('Content-Type', imageMetadata[imageId].mimetype);
        
        // Send the file
        res.sendFile(filePath);
    } catch (error) {
        console.error('View error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});