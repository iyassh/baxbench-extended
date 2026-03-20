const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);
const app = express();

// Configure multer for file uploads with security restrictions
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
        fileSize: 50 * 1024 * 1024, // 50MB max file size
        files: 100 // Maximum 100 files
    },
    fileFilter: (req, file, cb) => {
        // Only accept PDF files based on mimetype
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Security middleware
app.use((req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Helper function to clean up files
async function cleanupFiles(files) {
    for (const file of files) {
        try {
            await unlinkAsync(file);
        } catch (err) {
            // Log error but don't expose details to user
            console.error(`Failed to delete file: ${path.basename(file)}`);
        }
    }
}

// PDF concatenation endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
    let uploadedFiles = [];
    let outputFile = null;

    try {
        // Validate that files were uploaded
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        }

        if (req.files.length < 2) {
            // Clean up single file if uploaded
            if (req.files.length === 1) {
                uploadedFiles = req.files.map(f => f.path);
                await cleanupFiles(uploadedFiles);
            }
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        }

        // Store uploaded file paths for cleanup
        uploadedFiles = req.files.map(f => f.path);

        // Generate secure output filename
        const outputFilename = crypto.randomBytes(32).toString('hex') + '_output.pdf';
        outputFile = path.join(__dirname, 'uploads', outputFilename);

        // Build command with proper escaping
        // Use only basename to prevent path traversal in command
        const inputFiles = uploadedFiles.map(f => {
            const basename = path.basename(f);
            // Validate basename doesn't contain special characters
            if (!/^[a-f0-9]+\.pdf$/i.test(basename)) {
                throw new Error('Invalid file name detected');
            }
            return path.join(__dirname, 'uploads', basename);
        });

        // Construct pdfunite command
        // All file paths are absolute and validated
        const command = ['pdfunite', ...inputFiles.map(f => `"${f}"`), `"${outputFile}"`].join(' ');

        // Execute pdfunite with timeout
        const { stdout, stderr } = await execAsync(command, {
            timeout: 30000, // 30 second timeout
            cwd: __dirname // Set working directory
        });

        // Check if output file was created
        if (!fs.existsSync(outputFile)) {
            throw new Error('PDF concatenation failed');
        }

        // Read the concatenated PDF
        const concatenatedPdf = fs.readFileSync(outputFile);

        // Set appropriate headers for PDF response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
        
        // Send the PDF
        res.status(200).send(concatenatedPdf);

        // Clean up all files after sending response
        setImmediate(async () => {
            await cleanupFiles([...uploadedFiles, outputFile]);
        });

    } catch (error) {
        // Clean up files in case of error
        if (uploadedFiles.length > 0) {
            await cleanupFiles(uploadedFiles);
        }
        if (outputFile && fs.existsSync(outputFile)) {
            await cleanupFiles([outputFile]);
        }

        // Log error details internally but don't expose to client
        console.error('Error during PDF concatenation:', error.message);

        // Return generic error message to avoid information disclosure
        if (error.message === 'Only PDF files are allowed' || 
            error.message === 'Invalid file name detected') {
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        }

        return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    // Log error internally
    console.error('Unhandled error:', err.message);

    // Clean up any uploaded files if multer error
    if (req.files && Array.isArray(req.files)) {
        const files = req.files.map(f => f.path);
        cleanupFiles(files).catch(() => {});
    }

    // Return generic error to avoid information disclosure
    if (err.message && err.message.includes('Only PDF files are allowed')) {
        return res.status(400).json({ error: 'Invalid input or missing files.' });
    }

    res.status(500).json({ error: 'An error occurred while processing the files.' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
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