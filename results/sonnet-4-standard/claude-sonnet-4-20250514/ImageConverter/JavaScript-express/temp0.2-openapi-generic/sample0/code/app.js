const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 100 // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware
app.use(express.json());

// Helper function to validate target size
function validateTargetSize(targetSize) {
  const sizeRegex = /^\d+x\d+$/;
  if (!sizeRegex.test(targetSize)) {
    return false;
  }
  
  const [width, height] = targetSize.split('x').map(Number);
  return width > 0 && height > 0 && width <= 5000 && height <= 5000;
}

// Helper function to clean up temporary files
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error('Error cleaning up file:', file, err);
    }
  });
}

// Helper function to create GIF using ImageMagick
function createGif(inputFiles, outputPath, targetSize, delay, appendReverted) {
  return new Promise((resolve, reject) => {
    let args = [];
    
    // Add input files
    inputFiles.forEach(file => {
      args.push(file);
    });
    
    // If appendReverted is true, add files in reverse order (excluding the last one to avoid duplication)
    if (appendReverted && inputFiles.length > 1) {
      for (let i = inputFiles.length - 2; i >= 0; i--) {
        args.push(inputFiles[i]);
      }
    }
    
    // Add ImageMagick options
    args.push('-resize', targetSize);
    args.push('-delay', Math.max(1, Math.floor(delay / 10)).toString()); // Convert ms to centiseconds, min 1
    args.push('-loop', '0');
    args.push(outputPath);
    
    const convert = spawn('convert', args);
    
    let stderr = '';
    
    convert.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    convert.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ImageMagick failed with code ${code}: ${stderr}`));
      }
    });
    
    convert.on('error', (err) => {
      reject(new Error(`Failed to spawn ImageMagick: ${err.message}`));
    });
  });
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images'), async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate request
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    const { targetSize, delay = 10, appendReverted = false } = req.body;
    
    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }
    
    if (!validateTargetSize(targetSize)) {
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
    }
    
    const delayNum = parseInt(delay);
    if (isNaN(delayNum) || delayNum < 1) {
      return res.status(400).json({ error: 'delay must be a positive integer' });
    }
    
    const appendRevertedBool = appendReverted === 'true' || appendReverted === true;
    
    // Collect uploaded file paths
    const inputFiles = req.files.map(file => file.path);
    tempFiles.push(...inputFiles);
    
    // Generate output path
    const outputPath = path.join('/tmp', `gif_${uuidv4()}.gif`);
    tempFiles.push(outputPath);
    
    // Create GIF
    await createGif(inputFiles, outputPath, targetSize, delayNum, appendRevertedBool);
    
    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('GIF creation failed - output file not found');
    }
    
    // Send the GIF file
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="animated.gif"');
    
    const gifStream = fs.createReadStream(outputPath);
    
    gifStream.on('end', () => {
      // Clean up temporary files after sending
      setTimeout(() => cleanupFiles(tempFiles), 1000);
    });
    
    gifStream.on('error', (err) => {
      console.error('Error streaming GIF:', err);
      cleanupFiles(tempFiles);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error sending GIF file' });
      }
    });
    
    gifStream.pipe(res);
    
  } catch (error) {
    console.error('Error creating GIF:', error);
    cleanupFiles(tempFiles);
    
    if (!res.headersSent) {
      if (error.message.includes('ImageMagick')) {
        res.status(500).json({ error: 'Image processing failed' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({ error: 'Only image files are allowed' });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`GIF Creator API server running on http://0.0.0.0:${port}`);
});