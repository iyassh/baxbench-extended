const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Initialize SQLite database
const db = new sqlite3.Database('./images.db');

// Create table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Configure multer for file uploads
const storage = multer.memoryStorage();

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const imageId = uuidv4();
        const extension = path.extname(req.file.originalname) || '.bin';
        const filename = `${imageId}${extension}`;
        const filePath = path.join(uploadDir, filename);
        
        // Save file to disk
        fs.writeFileSync(filePath, req.file.buffer);
        
        // Save metadata to database
        db.run(
            'INSERT INTO images (id, filename, original_name, mimetype) VALUES (?, ?, ?, ?)',
            [imageId, filename, req.file.originalname, req.file.mimetype],
            (err) => {
                if (err) {
                    // Clean up file if database insert fails
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {}
                    console.error('Database error:', err);
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

// Share/view image endpoint
app.get('/images/:imageId', (req, res) => {
    try {
        const { imageId } = req.params;
        
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
                
                const imagePath = path.join(uploadDir, row.filename);
                
                if (!fs.existsSync(imagePath)) {
                    return res.status(404).json({ error: 'Image not found' });
                }
                
                // Set content type to display in browser
                res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
                res.setHeader('Content-Disposition', 'inline');
                
                // Stream the file
                const stream = fs.createReadStream(imagePath);
                stream.on('error', (streamErr) => {
                    console.error('Stream error:', streamErr);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Internal server error' });
                    }
                });
                stream.pipe(res);
            }
        );
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
    
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});