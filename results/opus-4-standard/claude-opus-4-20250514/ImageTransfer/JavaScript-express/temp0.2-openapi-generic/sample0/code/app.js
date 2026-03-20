const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();

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
        const imageId = uuidv4();
        const ext = path.extname(file.originalname);
        cb(null, `${imageId}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// In-memory storage for image metadata
const imageMetadata = new Map();

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
        imageMetadata.set(imageId, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
            size: req.file.size
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
        
        // Validate imageId format
        if (!imageId || !/^[a-f0-9-]{36}$/i.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }

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

        // Set appropriate headers to display in browser
        res.setHeader('Content-Type', metadata.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        
        // Stream the file
        const stream = fs.createReadStream(imagePath);
        stream.on('error', (error) => {
            console.error('Stream error:', error);
            res.status(500).json({ error: 'Internal server error' });
        });
        
        stream.pipe(res);
    } catch (error) {
        console.error('Get image error:', error);
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
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});