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

// Configure multer for file uploads with security limits
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate secure random filename to prevent path traversal
        const uniqueName = crypto.randomBytes(32).toString('hex') + '.pdf';
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit to prevent resource exhaustion
        files: 1,
        fields: 0
    },
    fileFilter: (req, file, cb) => {
        // Only accept PDF files
        if (file.mimetype === 'application/pdf' || 
            path.extname(file.originalname).toLowerCase() === '.pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Cleanup function for temporary files
const cleanupFile = async (filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) {
            await unlinkAsync(filePath);
        }
    } catch (err) {
        console.error('Cleanup error:', err.message);
    }
};

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
        
        // Validate file path is within uploads directory (prevent path traversal)
        const uploadsDir = path.join(__dirname, 'uploads');
        const resolvedPath = path.resolve(uploadedFilePath);
        if (!resolvedPath.startsWith(uploadsDir)) {
            await cleanupFile(uploadedFilePath);
            return res.status(400).json({ error: 'Invalid file path' });
        }

        // Generate output filename
        const outputFileName = crypto.randomBytes(32).toString('hex') + '.txt';
        outputFilePath = path.join(uploadsDir, outputFileName);

        // Execute pdftotext with timeout and restricted options
        const command = 'pdftotext';
        const args = [
            '-layout',
            '-nopgbrk',
            '-enc', 'UTF-8',
            uploadedFilePath,
            outputFilePath
        ];

        // Use execFile-like approach with explicit arguments to prevent command injection
        const { stdout, stderr } = await execAsync(
            `${command} ${args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ')}`,
            {
                timeout: 30000, // 30 second timeout to prevent resource exhaustion
                maxBuffer: 5 * 1024 * 1024, // 5MB max buffer
                cwd: uploadsDir,
                env: {} // Empty environment to prevent variable injection
            }
        );

        // Check if output file was created
        if (!fs.existsSync(outputFilePath)) {
            throw new Error('PDF conversion failed');
        }

        // Read the converted text
        const textContent = fs.readFileSync(outputFilePath, 'utf8');

        // Clean up files
        await cleanupFile(uploadedFilePath);
        await cleanupFile(outputFilePath);

        // Send the text content
        res.status(200).type('text/plain').send(textContent);

    } catch (error) {
        // Clean up files on error
        await cleanupFile(uploadedFilePath);
        await cleanupFile(outputFilePath);

        // Handle errors without exposing sensitive information
        if (error.message === 'Only PDF files are allowed' || 
            error.message === 'No file uploaded' ||
            error.message === 'Invalid file path') {
            return res.status(400).json({ error: error.message });
        }

        // Log error internally but don't expose details to client
        console.error('Conversion error:', error.message);
        
        // Generic error response to prevent information disclosure
        res.status(500).json({ error: 'Internal server error during conversion' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    // Clean up any uploaded file on multer errors
    if (req.file && req.file.path) {
        cleanupFile(req.file.path).catch(() => {});
    }

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }

    // Generic error response
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`PDF to Text API running on http://${HOST}:${PORT}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down server...');
    process.exit(0);
});