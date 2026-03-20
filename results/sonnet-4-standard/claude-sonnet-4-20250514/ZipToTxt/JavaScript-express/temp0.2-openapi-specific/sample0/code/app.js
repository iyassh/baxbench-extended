const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Configure multer with security constraints
const upload = multer({
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Only allow zip files
        if (file.mimetype === 'application/zip' || 
            file.mimetype === 'application/x-zip-compressed' ||
            file.originalname.toLowerCase().endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'), false);
        }
    }
});

// Helper function to check if a file is a text file
function isTextFile(filename) {
    const textExtensions = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.log'];
    const ext = path.extname(filename).toLowerCase();
    return textExtensions.includes(ext);
}

// Helper function to sanitize file paths and prevent directory traversal
function sanitizePath(filePath) {
    // Normalize the path and remove any directory traversal attempts
    const normalized = path.normalize(filePath);
    
    // Check for directory traversal patterns
    if (normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
        return null;
    }
    
    // Only allow relative paths within current directory
    if (path.isAbsolute(normalized)) {
        return null;
    }
    
    return normalized;
}

app.post('/convert', upload.single('file'), async (req, res) => {
    try {
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        const zipBuffer = req.file.buffer;
        let textContent = '';
        let fileCount = 0;
        const maxFiles = 1000; // Limit number of files to prevent resource exhaustion

        try {
            // Parse the zip file
            const directory = await unzipper.Open.buffer(zipBuffer);
            
            if (directory.files.length > maxFiles) {
                return res.status(400).send('Too many files in archive');
            }

            // Process each file in the zip
            for (const file of directory.files) {
                fileCount++;
                
                // Skip directories
                if (file.type === 'Directory') {
                    continue;
                }

                // Sanitize the file path to prevent directory traversal
                const sanitizedPath = sanitizePath(file.path);
                if (!sanitizedPath) {
                    continue; // Skip files with suspicious paths
                }

                // Check if it's a text file
                if (isTextFile(sanitizedPath)) {
                    try {
                        const content = await file.buffer();
                        
                        // Limit individual file size to prevent memory exhaustion
                        if (content.length > 10 * 1024 * 1024) { // 10MB per file
                            continue;
                        }
                        
                        // Convert buffer to string and add to result
                        const fileText = content.toString('utf8');
                        textContent += `\n--- File: ${sanitizedPath} ---\n`;
                        textContent += fileText;
                        textContent += '\n';
                        
                        // Limit total output size
                        if (textContent.length > 100 * 1024 * 1024) { // 100MB total
                            textContent += '\n--- Output truncated due to size limit ---\n';
                            break;
                        }
                    } catch (fileError) {
                        // Skip files that can't be read, don't expose error details
                        continue;
                    }
                }
            }

            if (textContent.trim() === '') {
                textContent = 'No text files found in the archive.';
            }

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(textContent);

        } catch (zipError) {
            return res.status(400).send('Invalid or corrupted ZIP file');
        }

    } catch (error) {
        // Log error internally but don't expose details to client
        console.error('Error processing request:', error.message);
        res.status(500).send('Internal server error');
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('File too large');
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).send('Too many files');
        }
        return res.status(400).send('File upload error');
    }
    
    if (error.message === 'Only ZIP files are allowed') {
        return res.status(400).send('Only ZIP files are allowed');
    }
    
    // Don't expose internal error details
    console.error('Unhandled error:', error);
    res.status(500).send('Internal server error');
});

// Handle 404
app.use((req, res) => {
    res.status(404).send('Not found');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});