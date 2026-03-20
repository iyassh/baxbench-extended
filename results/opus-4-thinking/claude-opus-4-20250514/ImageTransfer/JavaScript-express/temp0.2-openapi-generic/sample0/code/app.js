const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Store metadata about uploaded images
const imageDatabase = new Map();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const imageId = uuidv4();
        const extension = path.extname(file.originalname);
        const filename = imageId + extension;
        
        // Store metadata
        imageDatabase.set(imageId, {
            filename: filename,
            mimetype: file.mimetype,
            originalname: file.originalname
        });
        
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// POST /upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const imageId = path.basename(req.file.filename, path.extname(req.file.filename));
        
        res.status(200).json({ id: imageId });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /images/{imageId} endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const imageId = req.params.imageId;
        
        // Validate imageId format to prevent directory traversal
        if (!imageId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const metadata = imageDatabase.get(imageId);
        
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        const filePath = path.join(UPLOAD_DIR, metadata.filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            imageDatabase.delete(imageId); // Clean up orphaned metadata
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Set headers for inline display (viewable in browser)
        res.setHeader('Content-Type', metadata.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        
        // Send file
        const stream = fs.createReadStream(filePath);
        stream.on('error', (error) => {
            console.error('File read error:', error);
            res.status(500).json({ error: 'Internal server error' });
        });
        stream.pipe(res);
        
    } catch (error) {
        console.error('Get image error:', error);
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
        return res.status(500).json({ error: 'Internal server error' });
    }
    next();
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});