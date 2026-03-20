const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');

const execPromise = promisify(exec);
const unlinkPromise = promisify(fs.unlink);

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.post('/create-gif', upload.array('images'), async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    // Validate targetSize
    const targetSize = req.body.targetSize;
    if (!targetSize || !/^\d+x\d+$/.test(targetSize)) {
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
    }
    
    // Get delay (default 10ms)
    const delay = req.body.delay ? parseInt(req.body.delay) : 10;
    if (isNaN(delay) || delay < 0) {
      return res.status(400).json({ error: 'Invalid delay value' });
    }
    
    // Get appendReverted (default false)
    const appendReverted = req.body.appendReverted === 'true';
    
    // Store uploaded file paths
    const uploadedFiles = req.files.map(f => f.path);
    tempFiles.push(...uploadedFiles);
    
    // Prepare image list
    let imageFiles = [...uploadedFiles];
    
    // If appendReverted, add reversed images (excluding the last one to avoid duplication)
    if (appendReverted && uploadedFiles.length > 1) {
      const reversedFiles = [...uploadedFiles].reverse().slice(1);
      imageFiles = [...imageFiles, ...reversedFiles];
    }
    
    // Create output GIF path
    const outputPath = `/tmp/output-${Date.now()}-${Math.random().toString(36).slice(2, 11)}.gif`;
    tempFiles.push(outputPath);
    
    // Build ImageMagick command
    const delayInCentiseconds = Math.round(delay / 10);
    const imageFilesStr = imageFiles.map(f => `"${f}"`).join(' ');
    const command = `convert -delay ${delayInCentiseconds} -resize ${targetSize} ${imageFilesStr} "${outputPath}"`;
    
    // Execute ImageMagick command
    await execPromise(command);
    
    // Check if output file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Failed to create GIF');
    }
    
    // Send the GIF file
    res.setHeader('Content-Type', 'image/gif');
    const gifData = fs.readFileSync(outputPath);
    res.send(gifData);
    
  } catch (error) {
    console.error('Error creating GIF:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to create GIF: ' + error.message });
    }
  } finally {
    // Clean up temporary files
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          await unlinkPromise(file);
        }
      } catch (err) {
        console.error('Error deleting temp file:', err);
      }
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});