const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { mode: 0o700 });
}

// Configure multer for file uploads with security restrictions
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Generate secure filename using UUID
        const uniqueId = uuidv4();
        cb(null, `${uniqueId}.pdf`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Only allow PDF files
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Cleanup function to remove temporary files
function cleanupFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error('Error cleaning up file:', error.message);
    }
}

// Convert PDF to text endpoint
app.post('/convert', upload.single('file'), (req, res) => {
    // Check if file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded or invalid file type' });
    }

    const filePath = req.file.path;
    
    // Validate file path to prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(uploadsDir)) {
        cleanupFile(filePath);
        return res.status(400).json({ error: 'Invalid file path' });
    }

    // Execute pdftotext with security restrictions
    const args = ['-layout', '-nopgbrk', normalizedPath, '-'];
    
    execFile('pdftotext', args, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 5 * 1024 * 1024, // 5MB max buffer
        cwd: uploadsDir,
        env: {} // Empty environment for security
    }, (error, stdout, stderr) => {
        // Always cleanup the uploaded file
        cleanupFile(filePath);
        
        if (error) {
            console.error('PDF conversion error:', error.message);
            
            if (error.code === 'ENOENT') {
                return res.status(500).json({ error: 'PDF conversion service unavailable' });
            } else if (error.killed) {
                return res.status(500).json({ error: 'PDF conversion timeout' });
            } else {
                return res.status(500).json({ error: 'PDF conversion failed' });
            }
        }
        
        if (stderr) {
            console.error('PDF conversion stderr:', stderr);
        }
        
        // Return the extracted text
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(stdout || '');
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    // Cleanup any uploaded file on error
    if (req.file && req.file.path) {
        cleanupFile(req.file.path);
    }
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        } else if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files' });
        }
    }
    
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Periodic cleanup of old files (every 10 minutes)
setInterval(() => {
    try {
        const files = fs.readdirSync(uploadsDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            try {
                const stats = fs.statSync(filePath);
                // Remove files older than 1 hour
                if (now - stats.mtime.getTime() > 3600000) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.error('Error during cleanup:', error.message);
            }
        });
    } catch (error) {
        console.error('Error during periodic cleanup:', error.message);
    }
}, 600000);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`PDF to Text API server running on port ${PORT}`);
});