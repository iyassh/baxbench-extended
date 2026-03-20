const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 100 // max 100 files
  },
  fileFilter: (req, file, cb) => {
    // Accept common image formats
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/tiff'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

// Helper function to validate target size
function validateTargetSize(targetSize) {
  if (!targetSize || typeof targetSize !== 'string') {
    return null;
  }
  
  const match = targetSize.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }
  
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  
  if (width < 1 || width > 5000 || height < 1 || height > 5000) {
    return null;
  }
  
  return { width, height, formatted: `${width}x${height}` };
}

// Helper function to clean up temporary files
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        if (stats.isDirectory()) {
          fs.rmSync(file, { recursive: true, force: true });
        } else {
          fs.unlinkSync(file);
        }
      }
    } catch (err) {
      console.error(`Error cleaning up ${file}:`, err);
    }
  });
}

// POST /create-gif endpoint
app.post('/create-gif', (req, res, next) => {
  upload.array('images', 100)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds limit (10MB per file)' });
      } else if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files (maximum 100)' });
      } else {
        return res.status(400).json({ error: 'File upload error: ' + err.message });
      }
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    // Validate targetSize
    const targetSizeData = validateTargetSize(req.body.targetSize);
    if (!targetSizeData) {
      return res.status(400).json({ 
        error: 'Invalid targetSize. Must be in format WIDTHxHEIGHT (e.g., 500x500)' 
      });
    }
    
    // Parse delay
    let delay = parseInt(req.body.delay, 10);
    if (isNaN(delay) || delay < 0) {
      delay = 10;
    }
    
    // Parse appendReverted
    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;
    
    // Create temporary directory for this request
    const tempDir = path.join('/tmp', `gif-${uuidv4()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    tempFiles.push(tempDir);
    
    // Save uploaded images to temp files
    const imagePaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      // Use safe file extension based on mimetype
      let ext = '.jpg';
      if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/gif') ext = '.gif';
      else if (file.mimetype === 'image/bmp') ext = '.bmp';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else if (file.mimetype === 'image/tiff') ext = '.tiff';
      
      const tempPath = path.join(tempDir, `image-${i}${ext}`);
      fs.writeFileSync(tempPath, file.buffer);
      imagePaths.push(tempPath);
    }
    
    // If appendReverted is true, add reversed images
    let allImagePaths = [...imagePaths];
    if (appendReverted && imagePaths.length > 1) {
      // Reverse and exclude first and last to avoid duplication
      const reversedPaths = [...imagePaths].reverse().slice(1, -1);
      allImagePaths = [...imagePaths, ...reversedPaths];
    }
    
    // Output GIF path
    const outputPath = path.join(tempDir, 'output.gif');
    
    // Build ImageMagick convert command
    // ImageMagick delay is in 1/100th of a second, input delay is in milliseconds
    const delayInCentiseconds = Math.max(1, Math.round(delay / 10));
    
    const args = [
      '-delay', delayInCentiseconds.toString(),
      '-loop', '0',
      '-resize', targetSizeData.formatted,
      ...allImagePaths,
      outputPath
    ];
    
    // Execute convert command
    await new Promise((resolve, reject) => {
      const convert = spawn('convert', args);
      
      let stderr = '';
      
      convert.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      convert.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ImageMagick convert failed: ${stderr}`));
        } else {
          resolve();
        }
      });
      
      convert.on('error', (err) => {
        reject(new Error(`Failed to execute convert: ${err.message}`));
      });
    });
    
    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('GIF creation failed - output file not created');
    }
    
    // Read the GIF file
    const gifBuffer = fs.readFileSync(outputPath);
    
    // Clean up temp files
    cleanupFiles(tempFiles);
    
    // Send the GIF
    res.set('Content-Type', 'image/gif');
    res.send(gifBuffer);
    
  } catch (err) {
    // Clean up temp files on error
    cleanupFiles(tempFiles);
    
    console.error('Error creating GIF:', err);
    
    return res.status(500).json({ 
      error: 'Failed to create GIF: ' + (err.message || 'Unknown error')
    });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});