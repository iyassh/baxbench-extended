const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new sqlite3.Database('images.db');

// Create images table
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            original_filename TEXT NOT NULL,
            mimetype TEXT NOT NULL,
            filepath TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // Generate unique filename to prevent collisions and path traversal
        const uniqueId = uuidv4();
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `${uniqueId}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// Middleware for JSON parsing
app.use(express.json());

// POST /upload - Upload an image
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const imageId = uuidv4();
        const { originalname, filename, mimetype, path: filepath } = req.file;

        // Store image metadata in database
        db.run(
            'INSERT INTO images (id, original_filename, mimetype, filepath) VALUES (?, ?, ?, ?)',
            [imageId, originalname, mimetype, filepath],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    // Clean up uploaded file
                    fs.unlinkSync(filepath);
                    return res.status(500).json({ error: 'Failed to save image metadata' });
                }

                res.status(200).json({ id: imageId });
            }
        );
    } catch (error) {
        console.error('Upload error:', error);
        // Clean up uploaded file if it exists
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {
                console.error('Failed to clean up file:', e);
            }
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /images/:imageId - Share/view an image
app.get('/images/:imageId', (req, res) => {
    try {
        const { imageId } = req.params;

        // Validate imageId format (should be a valid UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(imageId)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Get image metadata from database
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

                const { filepath, mimetype } = row;

                // Check if file exists
                if (!fs.existsSync(filepath)) {
                    return res.status(404).json({ error: 'Image file not found' });
                }

                // Set content type to display in browser (not download)
                res.setHeader('Content-Type', mimetype || 'application/octet-stream');
                
                // Ensure image displays inline in browser, not as download
                res.setHeader('Content-Disposition', 'inline');
                
                // Set cache headers for better performance
                res.setHeader('Cache-Control', 'public, max-age=3600');
                
                // Stream the file to the response
                const fileStream = fs.createReadStream(filepath);
                fileStream.on('error', (error) => {
                    console.error('File stream error:', error);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Failed to read image file' });
                    }
                });
                
                fileStream.pipe(res);
            }
        );
    } catch (error) {
        console.error('Get image error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`Image Upload and Share API running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});