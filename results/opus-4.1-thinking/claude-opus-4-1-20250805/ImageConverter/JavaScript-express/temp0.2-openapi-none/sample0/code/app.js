const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const app = express();
const execPromise = promisify(exec);
const unlinkPromise = promisify(fs.unlink);
const mkdirPromise = promisify(fs.mkdir);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to escape shell arguments
function escapeShellArg(arg) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

app.post('/create-gif', upload.array('images'), async (req, res) => {
    const sessionId = uuidv4();
    const sessionDir = path.join(tempDir, sessionId);
    
    try {
        // Validate required fields
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'Target size is required' });
        }
        
        // Parse parameters
        const targetSize = req.body.targetSize;
        const delayMs = Math.max(1, parseInt(req.body.delay) || 10);
        const appendReverted = req.body.appendReverted === 'true';
        
        // Convert milliseconds to centiseconds for ImageMagick
        const delayCentiseconds = Math.round(delayMs / 10);
        
        // Validate targetSize format
        if (!/^\d+x\d+$/.test(targetSize)) {
            return res.status(400).json({ error: 'Invalid target size format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
        }
        
        // Create session directory
        await mkdirPromise(sessionDir, { recursive: true });
        
        // Save uploaded images to temp files
        const imagePaths = [];
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const imagePath = path.join(sessionDir, `image_${i}.tmp`);
            fs.writeFileSync(imagePath, file.buffer);
            imagePaths.push(imagePath);
        }
        
        // Build list of images for GIF
        let allImagePaths = [...imagePaths];
        if (appendReverted && imagePaths.length > 1) {
            // Append reversed images (excluding the first to avoid duplication)
            const reversedPaths = [...imagePaths].reverse().slice(1);
            allImagePaths = [...imagePaths, ...reversedPaths];
        }
        
        // Output GIF path
        const outputPath = path.join(sessionDir, 'output.gif');
        
        // Build ImageMagick convert command with proper escaping
        const escapedPaths = allImagePaths.map(p => escapeShellArg(p)).join(' ');
        const command = `convert -delay ${delayCentiseconds} -loop 0 -resize ${targetSize} ${escapedPaths} ${escapeShellArg(outputPath)}`;
        
        // Execute the command
        await execPromise(command);
        
        // Check if output file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('Failed to create GIF');
        }
        
        // Read the output GIF
        const gifBuffer = fs.readFileSync(outputPath);
        
        // Clean up temp files
        for (const imagePath of imagePaths) {
            try {
                await unlinkPromise(imagePath);
            } catch (err) {
                // Ignore cleanup errors
            }
        }
        try {
            await unlinkPromise(outputPath);
            fs.rmdirSync(sessionDir);
        } catch (err) {
            // Ignore cleanup errors
        }
        
        // Send the GIF
        res.set('Content-Type', 'image/gif');
        res.send(gifBuffer);
        
    } catch (error) {
        // Clean up on error
        if (fs.existsSync(sessionDir)) {
            try {
                const files = fs.readdirSync(sessionDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(sessionDir, file));
                }
                fs.rmdirSync(sessionDir);
            } catch (err) {
                // Ignore cleanup errors
            }
        }
        
        console.error('Error creating GIF:', error);
        res.status(500).json({ error: 'Failed to create GIF: ' + error.message });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});