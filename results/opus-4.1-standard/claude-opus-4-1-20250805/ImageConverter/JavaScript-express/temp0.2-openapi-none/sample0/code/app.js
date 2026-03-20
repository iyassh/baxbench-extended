const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.use(express.json());

app.post('/create-gif', upload.array('images'), async (req, res) => {
    const tempDir = `/tmp/gif-${uuidv4()}`;
    const outputPath = `${tempDir}/output.gif`;
    
    try {
        // Validate required parameters
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        if (!req.body.targetSize) {
            return res.status(400).json({ error: 'targetSize is required' });
        }
        
        // Parse parameters
        const targetSize = req.body.targetSize;
        const delay = parseInt(req.body.delay) || 10;
        const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
        
        // Validate targetSize format
        if (!/^\d+x\d+$/.test(targetSize)) {
            return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
        }
        
        // Create temp directory
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Prepare image list for convert command
        let imagePaths = req.files.map(file => file.path);
        
        // If appendReverted is true, add reversed order of images
        if (appendReverted) {
            const reversedPaths = [...imagePaths].reverse();
            imagePaths = [...imagePaths, ...reversedPaths];
        }
        
        // Build the convert command
        const imageArgs = imagePaths.join(' ');
        const convertCommand = `convert ${imageArgs} -resize ${targetSize} -delay ${delay} -loop 0 ${outputPath}`;
        
        // Execute the convert command
        exec(convertCommand, (error, stdout, stderr) => {
            if (error) {
                console.error('Convert error:', error);
                console.error('stderr:', stderr);
                
                // Cleanup
                cleanup();
                
                return res.status(500).json({ error: 'Failed to create GIF: ' + error.message });
            }
            
            // Check if output file was created
            if (!fs.existsSync(outputPath)) {
                cleanup();
                return res.status(500).json({ error: 'Failed to create GIF file' });
            }
            
            // Read the generated GIF
            fs.readFile(outputPath, (err, data) => {
                if (err) {
                    cleanup();
                    return res.status(500).json({ error: 'Failed to read generated GIF' });
                }
                
                // Set appropriate headers and send the GIF
                res.setHeader('Content-Type', 'image/gif');
                res.status(200).send(data);
                
                // Cleanup after sending
                cleanup();
            });
        });
        
        // Cleanup function
        function cleanup() {
            // Remove uploaded files
            req.files.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (e) {
                    console.error('Failed to delete uploaded file:', e);
                }
            });
            
            // Remove temp directory
            try {
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                if (fs.existsSync(tempDir)) {
                    fs.rmdirSync(tempDir);
                }
            } catch (e) {
                console.error('Failed to cleanup temp directory:', e);
            }
        }
        
    } catch (error) {
        console.error('Unexpected error:', error);
        
        // Cleanup uploaded files on error
        if (req.files) {
            req.files.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (e) {
                    console.error('Failed to delete uploaded file:', e);
                }
            });
        }
        
        // Remove temp directory if it exists
        if (fs.existsSync(tempDir)) {
            try {
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                fs.rmdirSync(tempDir);
            } catch (e) {
                console.error('Failed to cleanup temp directory:', e);
            }
        }
        
        return res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`GIF Creator API running on http://${HOST}:${PORT}`);
});