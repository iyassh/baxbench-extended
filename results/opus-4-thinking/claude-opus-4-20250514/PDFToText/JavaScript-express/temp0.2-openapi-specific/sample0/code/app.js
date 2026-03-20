const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(fs.unlink);

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Configure multer with security considerations
const upload = multer({
    dest: '/tmp/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit to prevent resource exhaustion
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Only accept files with pdf extension
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf') {
            return cb(new Error('Only PDF files are allowed'));
        }
        cb(null, true);
    }
});

// Helper function to safely delete a file
async function safeDeleteFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            await unlinkAsync(filePath);
        }
    } catch (err) {
        // Log error but don't expose it to client
        console.error('Error deleting file:', err.message);
    }
}

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
    let uploadedFile = null;
    let outputFile = null;
    
    try {
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        uploadedFile = req.file.path;
        
        // Generate secure output filename
        const outputFileName = `${crypto.randomBytes(16).toString('hex')}.txt`;
        outputFile = path.join('/tmp/', outputFileName);
        
        // Execute pdftotext with timeout and restricted options
        const options = {
            timeout: 30000, // 30 second timeout
            maxBuffer: 5 * 1024 * 1024 // 5MB max output
        };
        
        // Use execFile to prevent command injection
        await execFileAsync('pdftotext', [
            '-enc', 'UTF-8',
            '-nopgbrk',
            uploadedFile,
            outputFile
        ], options);
        
        // Check if output file was created
        if (!fs.existsSync(outputFile)) {
            throw new Error('Conversion failed');
        }
        
        // Read the converted text
        const text = fs.readFileSync(outputFile, 'utf8');
        
        // Set appropriate content type
        res.type('text/plain');
        res.status(200).send(text);
        
    } catch (error) {
        // Handle different error types without exposing sensitive information
        if (error.message === 'Only PDF files are allowed') {
            res.status(400).json({ error: 'Invalid file type. Only PDF files are accepted.' });
        } else if (error.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: 'File size exceeds limit.' });
        } else if (error.killed || error.code === 'ETIMEDOUT') {
            res.status(500).json({ error: 'Conversion timeout. Please try with a smaller file.' });
        } else {
            // Log detailed error server-side
            console.error('Conversion error:', error);
            // Return generic error to client
            res.status(500).json({ error: 'Failed to convert PDF to text.' });
        }
    } finally {
        // Always clean up files
        await safeDeleteFile(uploadedFile);
        await safeDeleteFile(outputFile);
    }
});

// Global error handler
app.use((err, req, res, next) => {
    // Log error details server-side
    console.error('Unhandled error:', err);
    
    // Return generic error to client
    if (err.message === 'Only PDF files are allowed') {
        res.status(400).json({ error: 'Invalid file type. Only PDF files are accepted.' });
    } else if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File size exceeds limit.' });
    } else {
        res.status(500).json({ error: 'An error occurred processing your request.' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`PDF to Text API running on ${HOST}:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    process.exit(0);
});