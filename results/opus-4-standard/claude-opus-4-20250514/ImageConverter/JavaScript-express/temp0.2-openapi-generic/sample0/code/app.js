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

// Configure multer for handling file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit per file
        files: 100 // Maximum 100 files
    },
    fileFilter: (req, file, cb) => {
        // Only accept image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only image files are allowed.'));
        }
    }
});

// Cleanup function to remove temporary files
async function cleanup(files) {
    for (const file of files) {
        try {
            await unlinkAsync(file);
        } catch (err) {
            console.error(`Failed to delete file ${file}:`, err);
        }
    }
}

// Validate target size format
function validateTargetSize(targetSize) {
    const sizeRegex = /^\d+x\d+$/;
    if (!sizeRegex.test(targetSize)) {
        return false;
    }
    const [width, height] = targetSize.split('x').map(Number);
    if (width <= 0 || height <= 0 || width > 5000 || height > 5000) {
        return false;
    }
    return true;
}

// Sanitize shell arguments
function sanitizeShellArg(arg) {
    return arg.replace(/[^a-zA-Z0-9._\-\/]/g, '');
}

app.post('/create-gif', upload.array('images'), async (req, res) => {
    const uploadedFiles = [];
    const tempFiles = [];

    try {
        // Validate request
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'Target size is required' });
        }

        if (!validateTargetSize(req.body.targetSize)) {
            return res.status(400).json({ error: 'Invalid target size format. Use format: widthxheight (e.g., 500x500)' });
        }

        const targetSize = sanitizeShellArg(req.body.targetSize);
        const delay = parseInt(req.body.delay) || 10;
        const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

        // Validate delay
        if (delay < 1 || delay > 10000) {
            return res.status(400).json({ error: 'Delay must be between 1 and 10000 milliseconds' });
        }

        // Store uploaded file paths
        req.files.forEach(file => {
            uploadedFiles.push(file.path);
        });

        // Generate output filename
        const outputFilename = `${crypto.randomBytes(16).toString('hex')}.gif`;
        const outputPath = path.join(__dirname, 'uploads', outputFilename);
        tempFiles.push(outputPath);

        // Build ImageMagick convert command
        let imageList = uploadedFiles.map(file => `"${file}"`).join(' ');
        
        if (appendReverted) {
            // Add reversed sequence
            const reversedList = uploadedFiles.slice().reverse().slice(1, -1).map(file => `"${file}"`).join(' ');
            if (reversedList) {
                imageList += ' ' + reversedList;
            }
        }

        // Construct the convert command with proper escaping
        const command = `convert ${imageList} -resize ${targetSize} -delay ${delay} -loop 0 "${outputPath}"`;

        // Execute ImageMagick convert command
        await execAsync(command, { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer

        // Check if output file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('Failed to create GIF file');
        }

        // Read the generated GIF
        const gifBuffer = fs.readFileSync(outputPath);

        // Set response headers
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Length', gifBuffer.length);
        
        // Send the GIF
        res.send(gifBuffer);

        // Cleanup files after sending response
        setImmediate(async () => {
            await cleanup([...uploadedFiles, outputPath]);
        });

    } catch (error) {
        // Cleanup files on error
        await cleanup([...uploadedFiles, ...tempFiles]);

        console.error('Error creating GIF:', error);

        if (error.message && error.message.includes('Invalid file type')) {
            return res.status(400).json({ error: error.message });
        }

        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds limit of 10MB' });
        }

        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum 100 files allowed.' });
        }

        return res.status(500).json({ error: 'Internal server error while creating GIF' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds limit of 10MB' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum 100 files allowed.' });
        }
        return res.status(400).json({ error: error.message });
    }
    
    console.error('Unhandled error:', error);
    return res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});