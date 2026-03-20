const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const app = express();
const execAsync = promisify(exec);
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

// Configure multer for file uploads with size limits
const upload = multer({
    dest: '/tmp/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Only accept PDF files
        if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Helper function to safely clean up files
async function cleanupFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            await unlinkAsync(filePath);
        }
    } catch (err) {
        // Log error but don't expose it to client
        console.error('Cleanup error:', err.message);
    }
}

// Convert PDF to text endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
    let uploadedFilePath = null;
    let outputFilePath = null;

    try {
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        uploadedFilePath = req.file.path;
        
        // Validate file exists and is readable
        if (!fs.existsSync(uploadedFilePath)) {
            return res.status(400).json({ error: 'File upload failed' });
        }

        // Generate secure output filename
        const outputFileName = `${crypto.randomBytes(16).toString('hex')}.txt`;
        outputFilePath = path.join('/tmp', outputFileName);

        // Construct pdftotext command with proper escaping
        const command = `pdftotext -layout -nopgbrk -enc UTF-8 "${uploadedFilePath}" "${outputFilePath}"`;
        
        // Execute pdftotext with timeout
        const options = {
            timeout: 30000, // 30 second timeout
            maxBuffer: 5 * 1024 * 1024 // 5MB max output
        };

        await execAsync(command, options);

        // Check if output file was created
        if (!fs.existsSync(outputFilePath)) {
            return res.status(500).json({ error: 'Conversion failed' });
        }

        // Read the converted text
        const textContent = fs.readFileSync(outputFilePath, 'utf8');

        // Set appropriate headers for text response
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(textContent);

    } catch (error) {
        // Handle different error types without exposing sensitive information
        if (error.message === 'Only PDF files are allowed') {
            return res.status(400).json({ error: 'Invalid file type' });
        }
        
        if (error.code === 'ETIMEDOUT') {
            return res.status(500).json({ error: 'Conversion timeout' });
        }
        
        if (error.killed || error.signal) {
            return res.status(500).json({ error: 'Conversion process terminated' });
        }

        // Generic error response
        console.error('Conversion error:', error.message);
        return res.status(500).json({ error: 'Conversion failed' });

    } finally {
        // Always clean up temporary files
        await cleanupFile(uploadedFilePath);
        await cleanupFile(outputFilePath);
    }
});

// Global error handler
app.use((err, req, res, next) => {
    // Don't expose internal error details
    console.error('Unhandled error:', err.message);
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Too many files' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});