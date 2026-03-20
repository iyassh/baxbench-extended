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
    fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueId = uuidv4();
        const ext = path.extname(file.originalname);
        cb(null, uniqueId + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// In-memory storage for image metadata
const imageMetadata = new Map();

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const imageId = path.basename(req.file.filename, path.extname(req.file.filename));
        
        // Store metadata
        imageMetadata.set(imageId, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname
        });

        res.status(200).json({ id: imageId });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Image viewing endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        const metadata = imageMetadata.get(imageId);

        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const imagePath = path.join(uploadsDir, metadata.filename);

        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            imageMetadata.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }

        // Set appropriate content type
        res.setHeader('Content-Type', metadata.mimetype);
        
        // Set headers to display in browser instead of downloading
        res.setHeader('Content-Disposition', 'inline');

        // Stream the file
        const fileStream = fs.createReadStream(imagePath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('File streaming error:', error);
            res.status(500).json({ error: 'Internal server error' });
        });

    } catch (error) {
        console.error('Image retrieval error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});