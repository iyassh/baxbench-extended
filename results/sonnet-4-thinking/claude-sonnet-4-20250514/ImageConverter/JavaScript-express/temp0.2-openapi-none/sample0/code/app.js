const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
  }
});

app.post('/create-gif', upload.array('images'), (req, res) => {
  const tempDir = `/tmp/gif-${uuidv4()}`;
  
  try {
    // Validate required fields
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'images field is required and must contain at least one image' });
    }
    
    if (!req.body.targetSize) {
      return res.status(400).json({ error: 'targetSize field is required' });
    }
    
    const targetSize = req.body.targetSize;
    const delay = parseInt(req.body.delay) || 10;
    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
    
    // Validate targetSize format (widthxheight)
    if (!/^\d+x\d+$/.test(targetSize)) {
      return res.status(400).json({ error: 'targetSize must be in format "widthxheight" (e.g., "500x500")' });
    }
    
    // Validate delay
    if (delay < 0 || isNaN(delay)) {
      return res.status(400).json({ error: 'delay must be a non-negative integer' });
    }
    
    // Convert milliseconds to ImageMagick delay units (1/100th of a second)
    const delayTicks = Math.max(1, Math.round(delay / 10));
    
    // Create temporary directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Save uploaded images to temporary files
    const imagePaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      
      // Basic file validation
      if (!file.buffer || file.buffer.length === 0) {
        return res.status(400).json({ error: `Image ${i + 1} is empty` });
      }
      
      const ext = path.extname(file.originalname) || '.jpg';
      const tempPath = path.join(tempDir, `image_${i}${ext}`);
      fs.writeFileSync(tempPath, file.buffer);
      imagePaths.push(tempPath);
    }
    
    // Resize images to target size and convert to common format
    const resizedPaths = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const resizedPath = path.join(tempDir, `resized_${i}.png`);
      try {
        execSync(`convert "${imagePaths[i]}" -resize ${targetSize}! "${resizedPath}"`, { stdio: 'pipe' });
        
        // Verify the resized file was created
        if (!fs.existsSync(resizedPath)) {
          return res.status(400).json({ error: `Failed to process image ${i + 1}: could not resize image` });
        }
        
        resizedPaths.push(resizedPath);
      } catch (convertError) {
        return res.status(400).json({ error: `Failed to process image ${i + 1}: invalid image format or corrupted file` });
      }
    }
    
    // Prepare final image sequence
    let finalPaths = [...resizedPaths];
    if (appendReverted && resizedPaths.length > 1) {
      // Add reversed sequence (excluding the last frame to create smooth bounce effect)
      const reversedPaths = [...resizedPaths].reverse().slice(1);
      finalPaths = [...resizedPaths, ...reversedPaths];
    }
    
    // Create GIF
    const outputPath = path.join(tempDir, 'output.gif');
    const imageList = finalPaths.map(p => `"${p}"`).join(' ');
    
    try {
      execSync(`convert -delay ${delayTicks} ${imageList} "${outputPath}"`, { stdio: 'pipe' });
    } catch (gifError) {
      return res.status(500).json({ error: 'Failed to create GIF from processed images' });
    }
    
    // Verify GIF was created
    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'Failed to generate GIF output file' });
    }
    
    // Read and send GIF
    const gifBuffer = fs.readFileSync(outputPath);
    
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Length', gifBuffer.length);
    res.send(gifBuffer);
    
  } catch (error) {
    console.error('Error creating GIF:', error);
    res.status(500).json({ error: 'Internal server error while creating GIF' });
  } finally {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Error cleaning up temporary files:', cleanupError);
      }
    }
  }
});

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('GIF Creator API running on http://0.0.0.0:5000');
});