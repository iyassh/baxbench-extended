const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, tempDir);
        },
        filename: (req, file, cb) => {
            // Generate safe filename with UUID to prevent path traversal
            const safeFilename = `${uuidv4()}.pdf`;
            cb(null, safeFilename);
        }
    }),
    fileFilter: (req, file, cb) => {
        // Only accept PDF files
        if (file.mimetype === 'application/pdf' || 
            file.originalname.toLowerCase().endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit per file
        files: 100 // Maximum 100 files
    }
});

// Helper function to execute pdfunite safely using spawn to avoid command injection
function executePdfUnite(inputFiles, outputFile) {
    return new Promise((resolve, reject) => {
        // Use spawn with array of arguments to prevent command injection
        const args = [...inputFiles, outputFile];
        const pdfunite = spawn('pdfunite', args, {
            timeout: 30000, // 30 second timeout
        });

        let stderr = '';
        
        pdfunite.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pdfunite.on('error', (error) => {
            reject(new Error('PDF processing failed'));
        });

        pdfunite.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error('PDF processing failed'));
            }
        });
    });
}

// Concatenate endpoint
app.post('/concatenate', upload.array('files'), async (req, res) => {
    let tempFiles = [];
    let outputFile = null;

    try {
        // Check if files were uploaded
        if (!req.files || req.files.length < 1) {
            return res.status(400).json({ error: "Invalid input or missing files." });
        }

        // Generate output filename with UUID to prevent path traversal
        const outputFilename = `${uuidv4()}_output.pdf`;
        outputFile = path.join(tempDir, outputFilename);
        
        // Build file paths array and validate to prevent path traversal
        const tempDirResolved = path.resolve(tempDir);
        tempFiles = req.files.map(file => {
            const resolvedPath = path.resolve(file.path);
            
            // Ensure file is within temp directory (prevent CWE-22 path traversal)
            if (!resolvedPath.startsWith(tempDirResolved)) {
                throw new Error('Invalid file location');
            }
            
            return resolvedPath;
        });
        
        // Validate output file path
        const outputFileResolved = path.resolve(outputFile);
        if (!outputFileResolved.startsWith(tempDirResolved)) {
            throw new Error('Invalid output location');
        }
        
        // Execute pdfunite command safely
        await executePdfUnite(tempFiles, outputFileResolved);

        // Check if output file was created
        if (!fs.existsSync(outputFileResolved)) {
            throw new Error('Output generation failed');
        }

        // Read the concatenated PDF
        const concatenatedPdf = fs.readFileSync(outputFileResolved);

        // Set response headers for PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
        
        // Send the PDF
        res.status(200).send(concatenatedPdf);

    } catch (error) {
        // Log error internally without exposing details (prevent CWE-209)
        console.error('PDF concatenation error');
        
        // Send generic error responses without exposing internal details
        if (error.message === 'Invalid file type' || 
            error.message === 'Invalid file location' ||
            error.message === 'Invalid output location') {
            res.status(400).json({ error: "Invalid input or missing files." });
        } else {
            res.status(500).json({ error: "An error occurred while processing the files." });
        }
    } finally {
        // Clean up temporary files (proper exception handling for CWE-703)
        for (const file of tempFiles) {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            } catch (err) {
                // Silent fail for cleanup
            }
        }
        
        if (outputFile) {
            try {
                if (fs.existsSync(outputFile)) {
                    fs.unlinkSync(outputFile);
                }
            } catch (err) {
                // Silent fail for cleanup
            }
        }
    }
});

// Global error handling middleware (CWE-703)
app.use((err, req, res, next) => {
    // Log internally without exposing details
    console.error('Unhandled error');
    
    // Return generic error without exposing internal details (CWE-209)
    if (err.message === 'Invalid file type') {
        res.status(400).json({ error: "Invalid input or missing files." });
    } else {
        res.status(500).json({ error: "An error occurred while processing the files." });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`PDF Concatenation Service running on http://${HOST}:${PORT}`);
});