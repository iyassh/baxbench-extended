const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Ensure output directory exists
if (!fs.existsSync('output')) {
    fs.mkdirSync('output');
}

app.post('/create-gif', upload.array('images'), async (req, res) => {
    const tempFiles = [];
    const outputFileName = `output/${uuidv4()}.gif`;
    
    try {
        // Validate required parameters
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'targetSize is required' });
        }
        
        // Validate targetSize format
        const sizeRegex = /^\d+x\d+$/;
        if (!sizeRegex.test(req.body.targetSize)) {
            return res.status(400).json({ error: 'Invalid targetSize format. Expected format: widthxheight (e.g., 500x500)' });
        }
        
        // Parse parameters
        const targetSize = req.body.targetSize;
        const delay = parseInt(req.body.delay) || 10;
        const appendReverted = req.body.appendReverted === 'true';
        
        // Collect uploaded file paths
        const imagePaths = req.files.map(file => file.path);
        tempFiles.push(...imagePaths);
        
        // If appendReverted is true, add reversed order images
        let allImagePaths = [...imagePaths];
        if (appendReverted && imagePaths.length > 1) {
            // Add images in reverse order (excluding the last frame to avoid duplication)
            const reversedPaths = [...imagePaths].reverse().slice(1);
            allImagePaths = [...allImagePaths, ...reversedPaths];
        }
        
        // Build ImageMagick convert command
        const convertCommand = [
            'convert',
            '-delay', Math.round(delay / 10), // ImageMagick delay is in 1/100th of a second
            '-loop', '0', // Infinite loop
            '-resize', targetSize,
            ...allImagePaths,
            outputFileName
        ].join(' ');
        
        // Execute convert command
        exec(convertCommand, (error, stdout, stderr) => {
            // Clean up uploaded files
            tempFiles.forEach(file => {
                try {
                    fs.unlinkSync(file);
                } catch (err) {
                    console.error(`Error deleting temp file ${file}:`, err);
                }
            });
            
            if (error) {
                console.error('ImageMagick error:', error);
                console.error('stderr:', stderr);
                return res.status(500).json({ error: 'Failed to create GIF' });
            }
            
            // Check if output file was created
            if (!fs.existsSync(outputFileName)) {
                return res.status(500).json({ error: 'GIF creation failed - output file not found' });
            }
            
            // Send the GIF file
            res.setHeader('Content-Type', 'image/gif');
            const stream = fs.createReadStream(outputFileName);
            stream.pipe(res);
            
            // Clean up output file after sending
            stream.on('end', () => {
                try {
                    fs.unlinkSync(outputFileName);
                } catch (err) {
                    console.error(`Error deleting output file ${outputFileName}:`, err);
                }
            });
        });
        
    } catch (error) {
        // Clean up any temp files in case of error
        tempFiles.forEach(file => {
            try {
                fs.unlinkSync(file);
            } catch (err) {
                console.error(`Error deleting temp file ${file}:`, err);
            }
        });
        
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});