const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// Configuration
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PORT = 5000;
const HOST = '0.0.0.0';

// Create upload directory if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Storage for image metadata
const imageMetadata = new Map();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Accept all files as per requirements, but we'll validate after
        cb(null, true);
    }
});

// Helper function to validate image file
const isValidImage = (buffer) => {
    // Check magic numbers for common image formats
    const magicNumbers = {
        jpg: [0xFF, 0xD8, 0xFF],
        png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
        gif: [0x47, 0x49, 0x46],
        webp: [0x52, 0x49, 0x46, 0x46],
        bmp: [0x42, 0x4D],
        ico: [0x00, 0x00, 0x01, 0x00],
        svg: [0x3C, 0x73, 0x76, 0x67] // <svg
    };

    for (const [format, signature] of Object.entries(magicNumbers)) {
        let match = true;
        for (let i = 0; i < signature.length; i++) {
            if (buffer[i] !== signature[i]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }

    // Additional check for SVG (text-based)
    const startStr = buffer.toString('utf8', 0, 100).toLowerCase();
    if (startStr.includes('<svg') || startStr.includes('<?xml')) {
        return true;
    }

    return false;
};

// Helper to get mime type from buffer
const getMimeType = (buffer, filename) => {
    const ext = path.extname(filename).toLowerCase();
    
    // Check magic numbers
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'image/png';
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'image/gif';
    } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        return 'image/webp';
    } else if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
        return 'image/bmp';
    } else if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
        return 'image/x-icon';
    }
    
    // Check for SVG
    const startStr = buffer.toString('utf8', 0, 100).toLowerCase();
    if (startStr.includes('<svg') || startStr.includes('<?xml')) {
        return 'image/svg+xml';
    }
    
    // Fallback to extension-based detection
    const extMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
    };
    
    return extMap[ext] || 'application/octet-stream';
};

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        // Validate that it's an image
        if (!isValidImage(req.file.buffer)) {
            return res.status(400).json({ error: 'Invalid image file' });
        }

        // Generate unique ID
        const imageId = uuidv4();
        
        // Sanitize filename to prevent path traversal
        const safeFilename = `${imageId}_${path.basename(req.file.originalname).replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = path.join(UPLOAD_DIR, safeFilename);
        
        // Determine mime type
        const mimeType = getMimeType(req.file.buffer, req.file.originalname);
        
        // Save file
        await fs.promises.writeFile(filePath, req.file.buffer);
        
        // Store metadata
        imageMetadata.set(imageId, {
            filename: safeFilename,
            originalName: req.file.originalname,
            mimeType: mimeType,
            uploadTime: new Date().toISOString()
        });

        res.status(200).json({ id: imageId });
    } catch (error) {
        console.error('Upload error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Share/view image endpoint
app.get('/images/:imageId', async (req, res) => {
    try {
        const { imageId } = req.params;
        
        // Validate imageId format (UUID v4)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Get metadata
        const metadata = imageMetadata.get(imageId);
        if (!metadata) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Construct file path safely
        const filePath = path.join(UPLOAD_DIR, metadata.filename);
        
        // Verify file exists and is within upload directory (prevent path traversal)
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            imageMetadata.delete(imageId);
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Read and send file
        const fileBuffer = await fs.promises.readFile(filePath);
        
        // Set headers to display image in browser
        res.setHeader('Content-Type', metadata.mimeType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        
        res.status(200).send(fileBuffer);
    } catch (error) {
        console.error('View error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});