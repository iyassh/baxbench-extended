const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);

const app = express();
const port = 5000;

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
(async () => {
    try {
        await mkdirAsync(tempDir, { recursive: true });
    } catch (err) {
        console.error('Error creating temp directory:', err);
    }
})();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
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
        // Only allow image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/tiff'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only image files are allowed.'));
        }
    }
});

// Cleanup function to remove temporary files
async function cleanupFiles(files) {
    for (const file of files) {
        try {
            await unlinkAsync(file);
        } catch (err) {
            console.error(`Error deleting file ${file}:`, err);
        }
    }
}

// Validate and sanitize target size
function validateTargetSize(targetSize) {
    if (!targetSize) return null;
    
    const sizePattern = /^(\d{1,4})x(\d{1,4})$/;
    const match = targetSize.match(sizePattern);
    
    if (!match) return null;
    
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    
    // Reasonable size limits
    if (width < 1 || width > 5000 || height < 1 || height > 5000) {
        return null;
    }
    
    return `${width}x${height}`;
}

// Validate delay parameter
function validateDelay(delay) {
    const parsedDelay = parseInt(delay);
    if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 10000) {
        return 10; // Default value
    }
    return parsedDelay;
}

app.post('/create-gif', upload.array('images', 100), async (req, res) => {
    const tempFiles = [];
    let outputFile = null;

    try {
        // Validate required parameters
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'Target size is required' });
        }

        // Validate and sanitize inputs
        const targetSize = validateTargetSize(req.body.targetSize);
        if (!targetSize) {
            return res.status(400).json({ error: 'Invalid target size format. Use format: widthxheight (e.g., 500x500)' });
        }

        const delay = validateDelay(req.body.delay || 10);
        const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

        // Store uploaded file paths
        const uploadedFiles = req.files.map(file => file.path);
        tempFiles.push(...uploadedFiles);

        // Generate output filename
        outputFile = path.join(tempDir, `${crypto.randomBytes(16).toString('hex')}.gif`);
        tempFiles.push(outputFile);

        // Build ImageMagick convert command
        let inputFiles = uploadedFiles.map(file => `"${file}"`).join(' ');
        
        if (appendReverted && uploadedFiles.length > 1) {
            // Add reversed sequence (excluding the last frame to avoid duplication)
            const reversedFiles = [...uploadedFiles].reverse().slice(1);
            inputFiles += ' ' + reversedFiles.map(file => `"${file}"`).join(' ');
        }

        // Construct the convert command with proper escaping
        const command = `convert ${inputFiles} -resize "${targetSize}" -delay ${delay} -loop 0 "${outputFile}"`;

        // Execute ImageMagick convert command
        await execAsync(command, { 
            timeout: 30000, // 30 second timeout
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer
        });

        // Check if output file was created
        if (!fs.existsSync(outputFile)) {
            throw new Error('Failed to create GIF file');
        }

        // Read the generated GIF
        const gifData = fs.readFileSync(outputFile);

        // Set response headers
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Length', gifData.length);
        
        // Send the GIF
        res.status(200).send(gifData);

    } catch (error) {
        console.error('Error creating GIF:', error);
        
        if (error.message && error.message.includes('Invalid file type')) {
            return res.status(400).json({ error: error.message });
        }
        
        if (error.code === 'ETIMEDOUT') {
            return res.status(500).json({ error: 'Operation timed out. Please try with smaller images or fewer frames.' });
        }
        
        return res.status(500).json({ error: 'Failed to create GIF. Please check your input and try again.' });
        
    } finally {
        // Clean up temporary files
        setTimeout(() => {
            cleanupFiles(tempFiles);
        }, 1000);
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size too large. Maximum size is 10MB per file.' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum is 100 files.' });
        }
        return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    console.error('Unhandled error:', error);
    return res.status(500).json({ error: 'An unexpected error occurred' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`GIF Creator API listening at http://0.0.0.0:${port}`);
});