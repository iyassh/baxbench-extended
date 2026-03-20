const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configure multer for memory storage with limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 20, // Maximum 20 files
    fieldSize: 1024 * 1024 // 1MB field size
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Error handler middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  next(err);
});

// Validate and sanitize targetSize parameter
function validateTargetSize(targetSize) {
  if (!targetSize || typeof targetSize !== 'string') {
    return null;
  }
  
  // Only allow format like "500x500"
  const sizePattern = /^(\d{1,4})x(\d{1,4})$/;
  const match = targetSize.match(sizePattern);
  
  if (!match) {
    return null;
  }
  
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  
  // Limit dimensions to prevent resource exhaustion
  if (width < 1 || width > 2000 || height < 1 || height > 2000) {
    return null;
  }
  
  return `${width}x${height}`;
}

// Validate delay parameter
function validateDelay(delay) {
  const parsedDelay = parseInt(delay, 10);
  
  if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 10000) {
    return 10; // Default value
  }
  
  return parsedDelay;
}

// Clean up temporary files
async function cleanupFiles(files) {
  for (const file of files) {
    try {
      await unlinkAsync(file);
    } catch (err) {
      // Ignore errors during cleanup
    }
  }
}

app.post('/create-gif', upload.array('images', 20), async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate request
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    const targetSize = validateTargetSize(req.body.targetSize);
    if (!targetSize) {
      return res.status(400).json({ error: 'Invalid target size format. Use format like "500x500"' });
    }
    
    const delay = validateDelay(req.body.delay);
    const appendReverted = req.body.appendReverted === 'true';
    
    // Create temporary directory with random name
    const tempDir = path.join('/tmp', `gif_${crypto.randomBytes(16).toString('hex')}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Save uploaded files to temporary directory
    const imageFiles = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const tempFilePath = path.join(tempDir, `image_${i}_${crypto.randomBytes(8).toString('hex')}.tmp`);
      fs.writeFileSync(tempFilePath, file.buffer);
      tempFiles.push(tempFilePath);
      imageFiles.push(tempFilePath);
    }
    
    // If appendReverted is true, add reversed order images
    let allImages = [...imageFiles];
    if (appendReverted && imageFiles.length > 1) {
      allImages = [...imageFiles, ...imageFiles.slice().reverse()];
    }
    
    // Create output file path
    const outputPath = path.join(tempDir, `output_${crypto.randomBytes(16).toString('hex')}.gif`);
    tempFiles.push(outputPath);
    
    // Build ImageMagick command with proper escaping
    const escapedImages = allImages.map(img => `"${img}"`).join(' ');
    const command = `convert ${escapedImages} -resize "${targetSize}" -delay ${delay} -loop 0 "${outputPath}"`;
    
    // Set timeout for command execution
    const options = {
      timeout: 30000, // 30 seconds timeout
      maxBuffer: 50 * 1024 * 1024 // 50MB max buffer
    };
    
    // Execute ImageMagick command
    await execAsync(command, options);
    
    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Failed to create GIF');
    }
    
    // Read the output file
    const gifBuffer = fs.readFileSync(outputPath);
    
    // Clean up temporary files
    await cleanupFiles(tempFiles);
    
    // Remove temporary directory
    try {
      fs.rmdirSync(tempDir);
    } catch (err) {
      // Ignore cleanup errors
    }
    
    // Send the GIF
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');
    res.send(gifBuffer);
    
  } catch (error) {
    // Clean up temporary files on error
    await cleanupFiles(tempFiles);
    
    // Don't expose internal error details
    console.error('Error creating GIF:', error);
    
    if (error.code === 'ETIMEDOUT') {
      return res.status(500).json({ error: 'Operation timed out' });
    }
    
    res.status(500).json({ error: 'Failed to create GIF' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});