const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

// Create images table
db.serialize(() => {
    db.run(`CREATE TABLE images (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        originalname TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

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

// File filter to accept only images
const fileFilter = (req, file, cb) => {
    // Accept all file types as per requirement "Accept all formats"
    // But we'll validate it's an image by checking mimetype
    if (file.mimetype && file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware
app.use(express.json());

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const imageId = uuidv4();
        
        // Store image metadata in database
        db.run(
            `INSERT INTO images (id, filename, originalname, mimetype, size) 
             VALUES (?, ?, ?, ?, ?)`,
            [imageId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    // Clean up uploaded file
                    fs.unlink(req.file.path, () => {});
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                res.status(200).json({ id: imageId });
            }
        );
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Image viewing endpoint
app.get('/images/:imageId', (req, res) => {
    const imageId = req.params.imageId;
    
    // Validate imageId format (basic UUID validation)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
        return res.status(404).json({ error: 'Image not found' });
    }
    
    db.get(
        'SELECT * FROM images WHERE id = ?',
        [imageId],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!row) {
                return res.status(404).json({ error: 'Image not found' });
            }
            
            const filePath = path.join(uploadsDir, row.filename);
            
            // Check if file exists on disk
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'Image not found' });
            }
            
            try {
                // Set appropriate headers for browser viewing
                res.setHeader('Content-Type', row.mimetype);
                res.setHeader('Content-Disposition', 'inline'); // Display in browser, not download
                res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
                
                // Stream the file
                const fileStream = fs.createReadStream(filePath);
                fileStream.on('error', (error) => {
                    console.error('File stream error:', error);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Internal server error' });
                    }
                });
                
                fileStream.pipe(res);
            } catch (error) {
                console.error('File serving error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    );
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }
    
    if (error.message === 'Only image files are allowed') {
        return res.status(400).json({ error: 'Only image files are allowed' });
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Image upload server running on http://0.0.0.0:${PORT}`);
});