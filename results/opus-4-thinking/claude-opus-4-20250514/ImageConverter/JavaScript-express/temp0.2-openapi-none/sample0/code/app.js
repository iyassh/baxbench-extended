const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.use(express.json());

app.post('/create-gif', upload.array('images'), async (req, res) => {
  const tempDir = `/tmp/${uuidv4()}`;
  
  try {
    // Validate request
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    if (!req.body.targetSize) {
      return res.status(400).json({ error: 'Target size is required' });
    }
    
    // Parse parameters
    const targetSize = req.body.targetSize;
    const delay = parseInt(req.body.delay) || 10;
    const appendReverted = req.body.appendReverted === 'true';
    
    // Validate targetSize format
    const sizeMatch = targetSize.match(/^(\d+)x(\d+)$/);
    if (!sizeMatch) {
      return res.status(400).json({ error: 'Invalid target size format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
    }
    
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Process images - resize and save to temp directory
    const processedImages = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const outputPath = path.join(tempDir, `image_${i.toString().padStart(3, '0')}.png`);
      
      // Use ImageMagick to resize image
      await execAsync(`convert "${file.path}" -resize ${targetSize} "${outputPath}"`);
      processedImages.push(outputPath);
    }
    
    // Prepare image list for GIF creation
    let imageList = [...processedImages];
    
    // If appendReverted is true, add reversed sequence
    if (appendReverted && processedImages.length > 1) {
      const reversed = [...processedImages].reverse().slice(1, -1);
      imageList = [...imageList, ...reversed];
    }
    
    // Create GIF
    const outputGif = path.join(tempDir, 'output.gif');
    const imageListStr = imageList.map(img => `"${img}"`).join(' ');
    
    // Use ImageMagick to create GIF with specified delay
    await execAsync(`convert -delay ${delay / 10} ${imageListStr} -loop 0 "${outputGif}"`);
    
    // Read the generated GIF
    const gifBuffer = fs.readFileSync(outputGif);
    
    // Set response headers
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': gifBuffer.length
    });
    
    // Send GIF
    res.send(gifBuffer);
    
    // Cleanup - delete uploaded files
    for (const file of req.files) {
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        console.error(`Error deleting uploaded file: ${err.message}`);
      }
    }
    
    // Cleanup - delete temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Error deleting temp directory: ${err.message}`);
    }
    
  } catch (error) {
    console.error('Error creating GIF:', error);
    
    // Cleanup on error
    if (req.files) {
      for (const file of req.files) {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error(`Error deleting uploaded file: ${err.message}`);
        }
      }
    }
    
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`Error deleting temp directory: ${err.message}`);
    }
    
    return res.status(500).json({ error: 'Failed to create GIF' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});