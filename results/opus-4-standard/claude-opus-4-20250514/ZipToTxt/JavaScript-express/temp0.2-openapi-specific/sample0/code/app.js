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
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' || 
            file.mimetype === 'application/x-zip-compressed' ||
            file.mimetype === 'multipart/x-zip') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Helper function to check if filename is safe
function isSafeFilename(filename) {
    // Remove any path traversal attempts
    const normalized = path.normalize(filename);
    const resolved = path.resolve('/', normalized);
    
    // Check for path traversal
    if (!resolved.startsWith('/')) {
        return false;
    }
    
    // Check for suspicious patterns
    const suspicious = ['..', '~', '\\', '\0'];
    for (const pattern of suspicious) {
        if (filename.includes(pattern)) {
            return false;
        }
    }
    
    return true;
}

// Helper function to check if file is text
function isTextFile(filename) {
    const textExtensions = ['.txt', '.text', '.md', '.log', '.csv', '.json', '.xml', '.html', '.htm', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'];
    const ext = path.extname(filename).toLowerCase();
    return textExtensions.includes(ext);
}

app.post('/convert', upload.single('file'), async (req, res) => {
    let tempDir = null;
    
    try {
        // Validate file upload
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        // Create temporary directory with random name
        const tempDirName = crypto.randomBytes(16).toString('hex');
        tempDir = path.join(__dirname, 'temp', tempDirName);
        
        // Ensure temp directory exists
        await fs.promises.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        await fs.promises.mkdir(tempDir, { recursive: true });

        const textContents = [];
        const processedFiles = new Set();
        let totalSize = 0;
        const maxTotalSize = 50 * 1024 * 1024; // 50MB total extracted size limit

        // Extract and process zip file
        await new Promise((resolve, reject) => {
            const stream = unzipper.Parse();
            
            stream.on('entry', async (entry) => {
                try {
                    const fileName = entry.path;
                    const type = entry.type;
                    
                    // Security check for filename
                    if (!isSafeFilename(fileName)) {
                        entry.autodrain();
                        return;
                    }
                    
                    // Skip directories
                    if (type === 'Directory') {
                        entry.autodrain();
                        return;
                    }
                    
                    // Check total size to prevent zip bombs
                    totalSize += entry.vars.uncompressedSize;
                    if (totalSize > maxTotalSize) {
                        entry.autodrain();
                        reject(new Error('Extracted content exceeds size limit'));
                        return;
                    }
                    
                    // Process only text files
                    if (isTextFile(fileName) && !processedFiles.has(fileName)) {
                        processedFiles.add(fileName);
                        
                        const chunks = [];
                        entry.on('data', (chunk) => chunks.push(chunk));
                        entry.on('end', () => {
                            try {
                                const content = Buffer.concat(chunks).toString('utf8');
                                // Validate UTF-8 content
                                if (content && !content.includes('\0')) {
                                    textContents.push(`=== ${path.basename(fileName)} ===\n${content}\n`);
                                }
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
            
            stream.on('error', reject);
            stream.on('close', resolve);
            
            // Create readable stream from buffer
            const bufferStream = require('stream').Readable.from(req.file.buffer);
            bufferStream.pipe(stream);
        });

        // Check if any text files were found
        if (textContents.length === 0) {
            return res.status(400).send('No text files found in the zip archive');
        }

        // Combine all text contents
        const combinedText = textContents.join('\n');
        
        // Set appropriate headers
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="combined.txt"');
        
        // Send the combined text
        res.status(200).send(combinedText);
        
    } catch (error) {
        // Log error internally without exposing details
        console.error('Conversion error:', error.message);
        
        // Send generic error message
        if (error.message && error.message.includes('size limit')) {
            res.status(400).send('File size exceeds allowed limit');
        } else {
            res.status(400).send('Invalid input');
        }
    } finally {
        // Cleanup temporary directory
        if (tempDir) {
            try {
                await fs.promises.rm(tempDir, { recursive: true, force: true });
            } catch (err) {
                // Ignore cleanup errors
            }
        }
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(400).send('Invalid input');
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err.message);
    process.exit(1);
});