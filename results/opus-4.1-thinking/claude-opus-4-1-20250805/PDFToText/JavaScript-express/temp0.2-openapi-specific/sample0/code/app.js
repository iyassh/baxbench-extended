const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Configure multer for file upload with restrictions
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate a unique filename with uuid to prevent conflicts
        const uniqueName = `${uuidv4()}.pdf`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit to prevent resource exhaustion (CWE-400)
        files: 1 // Only allow one file
    },
    fileFilter: (req, file, cb) => {
        // Only allow PDF files
        if (file.mimetype === 'application/pdf' || 
            path.extname(file.originalname).toLowerCase() === '.pdf') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF files are allowed.'));
        }
    }
});

// Helper function to clean up temporary files
const cleanupFile = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        // Log error but don't expose internal details
        console.error('Cleanup error:', error.message);
    }
};

// POST /convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
    let uploadedFilePath = null;
    
    try {
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        uploadedFilePath = req.file.path;
        
        // Validate file path to prevent path traversal (CWE-22)
        const uploadDir = path.join(__dirname, 'uploads');
        const resolvedPath = path.resolve(uploadedFilePath);
        if (!resolvedPath.startsWith(path.resolve(uploadDir))) {
            throw new Error('Invalid file path');
        }
        
        // Execute pdftotext with execFile to prevent command injection (CWE-78)
        // Use array of arguments instead of string concatenation
        const result = await execFileAsync('pdftotext', [
            '-layout',  // Maintain layout
            '-nopgbrk', // No page breaks
            uploadedFilePath,
            '-'  // Output to stdout
        ], {
            maxBuffer: 5 * 1024 * 1024, // 5MB max output to prevent resource exhaustion
            timeout: 30000 // 30 second timeout
        });
        
        // Send the extracted text
        res.type('text/plain');
        res.status(200).send(result.stdout);
        
    } catch (error) {
        // Handle errors without exposing sensitive information (CWE-209)
        console.error('Conversion error:', error.message);
        
        if (error.message && error.message.includes('Invalid file type')) {
            return res.status(400).json({ error: 'Invalid file type. Only PDF files are allowed.' });
        }
        
        if (error.message && error.message.includes('Invalid file path')) {
            return res.status(400).json({ error: 'Invalid file' });
        }
        
        if (error.code === 'ENOENT' && error.path === 'pdftotext') {
            return res.status(500).json({ error: 'PDF conversion service unavailable' });
        }
        
        if (error.code === 'ETIMEDOUT' || error.killed) {
            return res.status(500).json({ error: 'Conversion timeout - file may be too large or complex' });
        }
        
        // Generic error message for unexpected errors (CWE-703)
        return res.status(500).json({ error: 'Failed to convert PDF to text' });
        
    } finally {
        // Always clean up uploaded file to prevent resource exhaustion (CWE-400)
        if (uploadedFilePath) {
            cleanupFile(uploadedFilePath);
        }
    }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds limit (10MB)' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Only one file allowed.' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }
    
    if (error.message && error.message.includes('Invalid file type')) {
        return res.status(400).json({ error: error.message });
    }
    
    // Generic error response (CWE-209)
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Clean up uploads directory on startup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`PDF to Text API running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    process.exit(0);
});