const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Configure multer with size limits and memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
        files: 1,
        fields: 1
    },
    fileFilter: (req, file, cb) => {
        // Only accept zip files
        if (file.mimetype === 'application/zip' || 
            file.mimetype === 'application/x-zip-compressed' ||
            file.mimetype === 'multipart/x-zip' ||
            path.extname(file.originalname).toLowerCase() === '.zip') {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'), false);
        }
    }
});

// Helper function to check if filename is safe
function isSafeFilename(filename) {
    if (!filename) return false;
    
    // Normalize the path and check for directory traversal
    const normalized = path.normalize(filename);
    
    // Check for path traversal attempts
    if (normalized.includes('..') || 
        normalized.includes('./') ||
        normalized.startsWith('/') ||
        normalized.includes('\\') ||
        /^[a-zA-Z]:/.test(normalized)) {
        return false;
    }
    
    return true;
}

// Helper function to check if file is text
function isTextFile(filename) {
    if (!filename) return false;
    
    const textExtensions = [
        '.txt', '.text', '.md', '.markdown', '.log', '.csv', 
        '.json', '.xml', '.html', '.htm', '.css', '.js', 
        '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh',
        '.yaml', '.yml', '.ini', '.conf', '.config'
    ];
    
    const ext = path.extname(filename).toLowerCase();
    return textExtensions.includes(ext);
}

app.post('/convert', upload.single('file'), async (req, res) => {
    let tempDir = null;
    const startTime = Date.now();
    const timeout = 30000; // 30 second timeout
    
    try {
        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }
        
        // Create temporary directory with random name
        const tempDirName = `temp_${crypto.randomBytes(16).toString('hex')}`;
        tempDir = path.join(__dirname, tempDirName);
        
        // Ensure temp directory doesn't exist
        if (fs.existsSync(tempDir)) {
            return res.status(500).send('Internal server error');
        }
        
        fs.mkdirSync(tempDir, { recursive: true });
        
        const textContents = [];
        let processedFiles = 0;
        const maxFiles = 1000; // Limit number of files to prevent DoS
        let totalSize = 0;
        const maxTotalSize = 50 * 1024 * 1024; // 50MB max total extracted size
        
        // Process zip file
        await new Promise((resolve, reject) => {
            const stream = unzipper.Parse();
            
            stream.on('entry', async (entry) => {
                try {
                    // Check timeout
                    if (Date.now() - startTime > timeout) {
                        entry.autodrain();
                        return reject(new Error('Processing timeout'));
                    }
                    
                    // Check file count limit
                    if (processedFiles >= maxFiles) {
                        entry.autodrain();
                        return reject(new Error('Too many files in archive'));
                    }
                    
                    const fileName = entry.path;
                    
                    // Validate filename
                    if (!isSafeFilename(fileName)) {
                        entry.autodrain();
                        return;
                    }
                    
                    // Check if it's a text file and not a directory
                    if (entry.type === 'File' && isTextFile(fileName)) {
                        // Check size limits
                        if (entry.vars.uncompressedSize > 10 * 1024 * 1024) { // 10MB per file
                            entry.autodrain();
                            return;
                        }
                        
                        totalSize += entry.vars.uncompressedSize;
                        if (totalSize > maxTotalSize) {
                            entry.autodrain();
                            return reject(new Error('Archive too large'));
                        }
                        
                        // Read file content
                        const chunks = [];
                        entry.on('data', (chunk) => {
                            chunks.push(chunk);
                        });
                        
                        entry.on('end', () => {
                            try {
                                const content = Buffer.concat(chunks).toString('utf8');
                                // Sanitize content - remove null bytes
                                const sanitized = content.replace(/\0/g, '');
                                textContents.push(`=== ${path.basename(fileName)} ===\n${sanitized}\n\n`);
                                processedFiles++;
                            } catch (err) {
                                // Skip files that can't be decoded as UTF-8
                            }
                        });
                    } else {
                        entry.autodrain();
                    }
                } catch (err) {
                    entry.autodrain();
                }
            });
            
            stream.on('error', (err) => {
                reject(new Error('Invalid ZIP file'));
            });
            
            stream.on('close', () => {
                resolve();
            });
            
            // Pipe the buffer to unzipper
            const bufferStream = require('stream').Readable.from(req.file.buffer);
            bufferStream.pipe(stream);
        });
        
        // Combine all text contents
        if (textContents.length === 0) {
            return res.status(400).send('No text files found in the ZIP archive');
        }
        
        const combinedText = textContents.join('');
        
        // Set appropriate headers and send response
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(combinedText);
        
    } catch (error) {
        // Don't expose internal error details
        console.error('Error processing ZIP file:', error.message);
        
        if (error.message === 'Processing timeout' || 
            error.message === 'Too many files in archive' ||
            error.message === 'Archive too large') {
            return res.status(400).send(error.message);
        }
        
        return res.status(400).send('Invalid input');
    } finally {
        // Clean up temporary directory
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                console.error('Error cleaning up temp directory:', err.message);
            }
        }
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    
    // Don't expose error details
    if (err.message === 'Only ZIP files are allowed') {
        return res.status(400).send('Invalid input');
    }
    
    res.status(500).send('Internal server error');
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});