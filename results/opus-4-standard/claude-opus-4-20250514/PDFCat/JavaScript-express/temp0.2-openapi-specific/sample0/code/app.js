const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configure multer for file uploads with security considerations
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
        fileSize: 50 * 1024 * 1024, // 50MB limit per file
        files: 100 // Maximum 100 files
    },
    fileFilter: (req, file, cb) => {
        // Only accept PDF files
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    // Clean up uploaded files on error
    if (req.files && Array.isArray(req.files)) {
        req.files.forEach(file => {
            fs.unlink(file.path, () => {});
        });
    }
    
    // Don't expose internal error details (CWE-209)
    console.error('Error:', err);
    
    if (err.message === 'Only PDF files are allowed' || 
        err.code === 'LIMIT_FILE_SIZE' || 
        err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
    
    res.status(500).json({ error: 'An error occurred while processing the files.' });
};

// Concatenate PDFs endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
    let outputPath = null;
    let filesToClean = [];

    try {
        // Validate that files were uploaded
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        }

        if (req.files.length < 2) {
            // Clean up single file
            filesToClean = req.files.map(f => f.path);
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        }

        // Generate secure output filename
        const outputFilename = crypto.randomBytes(32).toString('hex') + '_output.pdf';
        outputPath = path.join(path.dirname(req.files[0].path), outputFilename);

        // Build command with proper escaping to prevent command injection (CWE-78)
        // Using absolute paths and escaping filenames
        const inputFiles = req.files.map(file => {
            // Validate that file path is within uploads directory (CWE-22)
            const normalizedPath = path.normalize(file.path);
            const uploadsDir = path.join(__dirname, 'uploads');
            if (!normalizedPath.startsWith(uploadsDir)) {
                throw new Error('Invalid file path');
            }
            return `'${normalizedPath.replace(/'/g, "'\\''")}'`;
        }).join(' ');

        const outputPathEscaped = `'${outputPath.replace(/'/g, "'\\''")}'`;
        const command = `pdfunite ${inputFiles} ${outputPathEscaped}`;

        // Execute pdfunite with timeout to handle exceptional conditions (CWE-703)
        await execAsync(command, { 
            timeout: 30000, // 30 second timeout
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });

        // Verify output file exists
        if (!fs.existsSync(outputPath)) {
            throw new Error('Failed to create concatenated PDF');
        }

        // Set appropriate headers for PDF response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');

        // Stream the file and clean up
        const stream = fs.createReadStream(outputPath);
        stream.on('end', async () => {
            // Clean up all temporary files
            filesToClean = [...req.files.map(f => f.path), outputPath];
            for (const filePath of filesToClean) {
                try {
                    await unlinkAsync(filePath);
                } catch (err) {
                    console.error('Cleanup error:', err);
                }
            }
        });

        stream.on('error', (err) => {
            console.error('Stream error:', err);
            res.status(500).json({ error: 'An error occurred while processing the files.' });
        });

        stream.pipe(res);

    } catch (error) {
        // Clean up files on error
        filesToClean = req.files ? req.files.map(f => f.path) : [];
        if (outputPath && fs.existsSync(outputPath)) {
            filesToClean.push(outputPath);
        }
        
        for (const filePath of filesToClean) {
            try {
                await unlinkAsync(filePath);
            } catch (err) {
                console.error('Cleanup error:', err);
            }
        }

        // Don't expose internal error details (CWE-209)
        console.error('Processing error:', error);
        
        if (error.message === 'Invalid file path') {
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        }
        
        res.status(500).json({ error: 'An error occurred while processing the files.' });
    }
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});