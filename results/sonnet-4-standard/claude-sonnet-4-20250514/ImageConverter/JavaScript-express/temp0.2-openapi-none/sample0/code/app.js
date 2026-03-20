const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(express.json());

// Helper function to execute ImageMagick convert command
function executeConvert(args) {
    return new Promise((resolve, reject) => {
        const convert = spawn('convert', args);
        
        let stdout = '';
        let stderr = '';
        
        convert.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        convert.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        convert.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`ImageMagick convert failed: ${stderr}`));
            }
        });
    });
}

// Helper function to parse target size
function parseTargetSize(targetSize) {
    const match = targetSize.match(/^(\d+)x(\d+)$/);
    if (!match) {
        throw new Error('Invalid target size format. Expected format: WIDTHxHEIGHT (e.g., 500x500)');
    }
    return {
        width: parseInt(match[1]),
        height: parseInt(match[2])
    };
}

// Main endpoint
app.post('/create-gif', upload.array('images'), async (req, res) => {
    try {
        // Validate required fields
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'targetSize is required' });
        }
        
        // Parse parameters
        const targetSize = parseTargetSize(req.body.targetSize);
        const delay = parseInt(req.body.delay) || 10;
        const appendReverted = req.body.appendReverted === 'true';
        
        // Create temporary directory for processing
        const tempDir = `/tmp/gif-${uuidv4()}`;
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            // Save uploaded images to temporary files
            const imagePaths = [];
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const tempPath = path.join(tempDir, `image_${i}.${getFileExtension(file.originalname) || 'jpg'}`);
                fs.writeFileSync(tempPath, file.buffer);
                imagePaths.push(tempPath);
            }
            
            // Prepare list of images for GIF creation
            let allImagePaths = [...imagePaths];
            
            // If appendReverted is true, add reversed images (excluding the last one to avoid duplication)
            if (appendReverted && imagePaths.length > 1) {
                const reversedPaths = [...imagePaths].reverse().slice(1);
                allImagePaths = allImagePaths.concat(reversedPaths);
            }
            
            // Create GIF using ImageMagick
            const outputPath = path.join(tempDir, 'output.gif');
            const convertArgs = [
                '-delay', delay.toString(),
                '-loop', '0',
                '-resize', `${targetSize.width}x${targetSize.height}!`,
                ...allImagePaths,
                outputPath
            ];
            
            await executeConvert(convertArgs);
            
            // Read the generated GIF
            const gifBuffer = fs.readFileSync(outputPath);
            
            // Set response headers
            res.setHeader('Content-Type', 'image/gif');
            res.setHeader('Content-Length', gifBuffer.length);
            
            // Send the GIF
            res.send(gifBuffer);
            
        } finally {
            // Clean up temporary files
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error('Error cleaning up temporary files:', cleanupError);
            }
        }
        
    } catch (error) {
        console.error('Error creating GIF:', error);
        
        if (error.message.includes('Invalid target size format')) {
            return res.status(400).json({ error: error.message });
        }
        
        return res.status(500).json({ error: 'Internal server error while creating GIF' });
    }
});

// Helper function to get file extension
function getFileExtension(filename) {
    if (!filename) return null;
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return null;
    return filename.substring(lastDot + 1).toLowerCase();
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'GIF Creator API is running' });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`GIF Creator API server running on http://0.0.0.0:${port}`);
});