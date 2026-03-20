const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const execAsync = promisify(exec);

// Configure multer for temporary file storage
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 100 // Maximum 100 files
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

// Middleware
app.use(express.json());

// Helper function to validate target size format
function validateTargetSize(targetSize) {
  const sizePattern = /^\d+x\d+$/;
  if (!sizePattern.test(targetSize)) {
    return false;
  }
  const [width, height] = targetSize.split('x').map(Number);
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
    return false;
  }
  return true;
}

// Helper function to clean up files
async function cleanupFiles(files) {
  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch (error) {
      console.error(`Failed to delete file ${file}:`, error);
    }
  }
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images'), async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate required parameters
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    const targetSize = req.body.targetSize;
    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }

    if (!validateTargetSize(targetSize)) {
      return res.status(400).json({ error: 'Invalid targetSize format. Use format like "500x500"' });
    }

    // Parse optional parameters
    let delay = parseInt(req.body.delay) || 10;
    if (delay < 0 || delay > 10000) {
      return res.status(400).json({ error: 'delay must be between 0 and 10000' });
    }

    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

    // Generate unique output filename
    const outputFilename = path.join('/tmp', `gif_${crypto.randomBytes(16).toString('hex')}.gif`);
    tempFiles.push(outputFilename);

    // Collect uploaded file paths
    const uploadedFiles = req.files.map(file => file.path);
    tempFiles.push(...uploadedFiles);

    // Build ImageMagick convert command
    let command = 'convert';
    
    // Add delay parameter (ImageMagick uses centiseconds)
    const delayInCentiseconds = Math.round(delay / 10);
    command += ` -delay ${delayInCentiseconds}`;
    
    // Add resize parameter
    command += ` -resize ${targetSize}`;
    
    // Add input images
    for (const file of uploadedFiles) {
      command += ` "${file}"`;
    }
    
    // If appendReverted is true, add reversed images
    if (appendReverted) {
      for (let i = uploadedFiles.length - 2; i >= 0; i--) {
        command += ` "${uploadedFiles[i]}"`;
      }
    }
    
    // Add loop parameter and output file
    command += ` -loop 0 "${outputFilename}"`;

    // Execute the command
    await execAsync(command, { timeout: 30000 }); // 30 second timeout

    // Read the generated GIF
    const gifBuffer = await fs.readFile(outputFilename);

    // Clean up temp files
    await cleanupFiles(tempFiles);

    // Send the GIF
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': gifBuffer.length
    });
    res.send(gifBuffer);

  } catch (error) {
    // Clean up temp files on error
    await cleanupFiles(tempFiles);

    if (error.message && error.message.includes('Invalid file type')) {
      return res.status(400).json({ error: error.message });
    }

    console.error('Error creating GIF:', error);
    res.status(500).json({ error: 'Failed to create GIF' });
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
  }
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GIF Creator API listening on 0.0.0.0:${PORT}`);
});