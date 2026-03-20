const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Only accept zip files
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.zip') {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'), false);
        }
    }
});

// Helper function to check if a file is a text file
function isTextFile(filename) {
    const textExtensions = ['.txt', '.md', '.log', '.csv', '.json', '.xml', '.html', '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'];
    const ext = path.extname(filename).toLowerCase();
    return textExtensions.includes(ext) || !ext;
}

// Convert endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded');
    }

    if (!req.file.buffer) {
        return res.status(400).send('Invalid file data');
    }

    const tempDir = path.join(__dirname, 'temp', crypto.randomBytes(16).toString('hex'));
    
    try {
        // Create temporary directory
        fs.mkdirSync(tempDir, { recursive: true });
        
        let combinedText = '';
        const processedFiles = [];
        
        // Create a promise to handle the unzip stream
        await new Promise((resolve, reject) => {
            const stream = unzipper.Parse();
            
            stream.on('entry', async (entry) => {
                const fileName = entry.path;
                const type = entry.type;
                
                // Skip directories and non-text files
                if (type === 'Directory' || !isTextFile(fileName)) {
                    entry.autodrain();
                    return;
                }
                
                // Sanitize file path to prevent directory traversal
                const sanitizedFileName = path.basename(fileName);
                if (sanitizedFileName.includes('..') || path.isAbsolute(fileName)) {
                    entry.autodrain();
                    return;
                }
                
                try {
                    // Read the file content
                    const chunks = [];
                    entry.on('data', (chunk) => chunks.push(chunk));
                    entry.on('end', () => {
                        const content = Buffer.concat(chunks).toString('utf8');
                        processedFiles.push({
                            name: fileName,
                            content: content
                        });
                    });
                } catch (err) {
                    entry.autodrain();
                }
            });
            
            stream.on('finish', () => {
                resolve();
            });
            
            stream.on('error', (err) => {
                reject(err);
            });
            
            // Write the buffer to the stream
            stream.write(req.file.buffer);
            stream.end();
        });
        
        // Sort files by name for consistent output
        processedFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        // Combine all text files
        for (const file of processedFiles) {
            if (combinedText.length > 0) {
                combinedText += '\n\n';
            }
            combinedText += `=== ${file.name} ===\n`;
            combinedText += file.content;
        }
        
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        if (combinedText.length === 0) {
            return res.status(400).send('No text files found in the zip archive');
        }
        
        // Send the combined text as response
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(combinedText);
        
    } catch (error) {
        // Clean up on error
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        console.error('Error processing zip file:', error);
        res.status(400).send('Error processing zip file');
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('File size too large');
        }
        return res.status(400).send('File upload error');
    }
    
    if (error) {
        return res.status(400).send(error.message || 'Invalid input');
    }
    
    next();
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});