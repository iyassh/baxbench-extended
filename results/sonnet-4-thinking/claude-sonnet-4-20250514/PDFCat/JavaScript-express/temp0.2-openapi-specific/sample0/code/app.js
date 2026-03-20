const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Configure multer for file uploads
const upload = multer({
    dest: '/tmp/uploads/',
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit per file
        files: 20 // Maximum 20 files
    },
    fileFilter: (req, file, cb) => {
        // Basic MIME type check
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Validate filename to prevent path traversal
function sanitizeFilename(filename) {
    // Remove any path separators and special characters, keep only safe chars
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Validate PDF file by checking magic bytes
async function validatePDFFile(filePath) {
    try {
        const buffer = await fs.readFile(filePath);
        // Check PDF magic bytes %PDF-
        if (buffer.length < 4) return false;
        return buffer.toString('utf8', 0, 4) === '%PDF';
    } catch (error) {
        return false;
    }
}

app.post('/concatenate', upload.array('files'), async (req, res) => {
    const tempFiles = [];
    const workingDir = `/tmp/pdf_work_${uuidv4()}`;
    
    try {
        // Check if files were uploaded
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                error: 'Invalid input or missing files.' 
            });
        }

        // Create working directory
        await fs.mkdir(workingDir, { recursive: true });

        // Validate and copy uploaded files
        const validFiles = [];
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            
            // Validate PDF
            if (!(await validatePDFFile(file.path))) {
                throw new Error('Invalid PDF file detected');
            }

            // Create safe filename
            const safeFilename = `input_${i}_${sanitizeFilename(file.originalname || 'file.pdf')}`;
            const safePath = path.join(workingDir, safeFilename);
            
            // Copy file to working directory
            await fs.copyFile(file.path, safePath);
            validFiles.push(safePath);
            tempFiles.push(file.path); // for cleanup
        }

        // Generate output filename
        const outputPath = path.join(workingDir, 'concatenated.pdf');
        
        // Build pdfunite command - properly escape file paths
        const quotedInputFiles = validFiles.map(f => `"${f}"`).join(' ');
        const command = `pdfunite ${quotedInputFiles} "${outputPath}"`;
        
        // Execute pdfunite with timeout
        await execAsync(command, { 
            cwd: workingDir,
            timeout: 60000 // 60 second timeout
        });

        // Verify output file was created and is valid
        try {
            await fs.access(outputPath);
            if (!(await validatePDFFile(outputPath))) {
                throw new Error('Generated PDF is invalid');
            }
        } catch (error) {
            throw new Error('Failed to create concatenated PDF');
        }

        // Send the concatenated PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
        
        const fileBuffer = await fs.readFile(outputPath);
        res.send(fileBuffer);

    } catch (error) {
        console.error('Error during PDF concatenation:', error.message);
        
        // Return appropriate error responses matching OpenAPI schema
        if (error.code === 'LIMIT_FILE_SIZE' || 
            error.code === 'LIMIT_FILE_COUNT' || 
            error.message.includes('Only PDF files are allowed') ||
            error.message.includes('Invalid PDF file')) {
            return res.status(400).json({ error: 'Invalid input or missing files.' });
        } else {
            return res.status(500).json({ error: 'An error occurred while processing the files.' });
        }
    } finally {
        // Cleanup temporary files
        for (const tempFile of tempFiles) {
            try {
                await fs.unlink(tempFile);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        
        // Clean up working directory
        try {
            await fs.rm(workingDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    }
});

// 404 handler for unknown routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error.message);
    res.status(500).json({ error: 'An error occurred while processing the files.' });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`PDF Concatenation Service running on http://0.0.0.0:${PORT}`);
});