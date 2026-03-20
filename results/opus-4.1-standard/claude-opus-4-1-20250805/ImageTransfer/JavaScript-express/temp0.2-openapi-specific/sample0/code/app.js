const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Security middleware
app.use((req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Store file metadata in memory (in production, use a database)
const fileMetadata = new Map();

// Configure multer for file upload with security measures
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1,
        fields: 0,
        parts: 2
    },
    fileFilter: (req, file, cb) => {
        // Validate file is an image by checking MIME type
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
    }
});

// Helper function to validate image magic numbers
function validateImageBuffer(buffer) {
    if (!buffer || buffer.length < 4) {
        return false;
    }
    
    // Check magic numbers for common image formats
    const magicNumbers = {
        jpg: [0xFF, 0xD8, 0xFF],
        png: [0x89, 0x50, 0x4E, 0x47],
        gif: [0x47, 0x49, 0x46],
        bmp: [0x42, 0x4D],
        webp: [0x52, 0x49, 0x46, 0x46],
        tiff: [[0x49, 0x49, 0x2A, 0x00], [0x4D, 0x4D, 0x00, 0x2A]]
    };
    
    // Check JPG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return true;
    }
    
    // Check PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return true;
    }
    
    // Check GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return true;
    }
    
    // Check BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
        return true;
    }
    
    // Check WebP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        if (buffer.length > 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return true;
        }
    }
    
    // Check TIFF
    if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
        (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) {
        return true;
    }
    
    // Check SVG (text-based, check for common SVG patterns)
    const bufferString = buffer.toString('utf8', 0, Math.min(buffer.length, 1000));
    if (bufferString.includes('<svg') || bufferString.includes('<?xml')) {
        return true;
    }
    
    return false;
}

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Validate file buffer contains actual image data
        if (!validateImageBuffer(req.file.buffer)) {
            return res.status(400).json({ error: 'Invalid image file' });
        }
        
        // Generate secure random ID
        const imageId = uuidv4();
        
        // Generate secure filename with original extension
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        const secureFilename = `${imageId}${fileExtension}`;
        
        // Ensure the filename doesn't contain path traversal attempts
        if (secureFilename.includes('..') || secureFilename.includes('/') || secureFilename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        // Construct safe file path
        const filePath = path.join(UPLOAD_DIR, secureFilename);
        
        // Verify the resolved path is within the upload directory
        const resolvedPath = path.resolve(filePath);
        const resolvedUploadDir = path.resolve(UPLOAD_DIR);
        if (!resolvedPath.startsWith(resolvedUploadDir)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }
        
        // Save file to disk
        await fs.promises.writeFile(filePath, req.file.buffer);
        
        // Store metadata
        fileMetadata.set(imageId, {
            filename: secureFilename,
            mimetype: req.file.mimetype,
            uploadTime: new Date().toISOString()
        });
        
        res.status(200).json({ id: imageId });
        
    } catch (error) {
        console.error('Upload error:', error.message);
        
        // Don't expose internal error details
        if (error.message && error.message.includes('Invalid file type')) {
            return res.status(400).json({ error: 'Invalid file type. Only image files are allowed.' });
        }
        
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Share/view image endpoint
app.get('/images/:imageId', async (req, res) => {
    try {
        const imageId = req.params.imageId;
        
        // Validate imageId format (UUID v4)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Get file metadata
        const metadata = fileMetadata.get(imageId);
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Construct file path safely
        const filePath = path.join(UPLOAD_DIR, metadata.filename);
        
        // Verify the resolved path is within the upload directory
        const resolvedPath = path.resolve(filePath);
        const resolvedUploadDir = path.resolve(UPLOAD_DIR);
        if (!resolvedPath.startsWith(resolvedUploadDir)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            // Remove metadata for non-existent file
            fileMetadata.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Read file
        const fileBuffer = await fs.promises.readFile(filePath);
        
        // Set appropriate headers for viewing in browser
        res.setHeader('Content-Type', metadata.mimetype);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        // Send file
        res.status(200).send(fileBuffer);
        
    } catch (error) {
        console.error('Retrieval error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});