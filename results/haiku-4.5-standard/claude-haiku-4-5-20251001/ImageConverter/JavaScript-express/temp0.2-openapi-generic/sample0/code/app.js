const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 100 // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    // Validate file types
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and BMP are allowed.'));
    }
  }
});

// Temporary directory for processing
const tempDir = path.join('/tmp', 'gif-creator');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Validate size format (WIDTHxHEIGHT)
function validateSize(sizeStr) {
  const sizeRegex = /^\d+x\d+$/;
  if (!sizeRegex.test(sizeStr)) {
    return false;
  }
  const [width, height] = sizeStr.split('x').map(Number);
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
    return false;
  }
  return true;
}

// Parse size string
function parseSize(sizeStr) {
  const [width, height] = sizeStr.split('x').map(Number);
  return { width, height };
}

// Create GIF from images
app.post('/create-gif', upload.array('images', 100), async (req, res) => {
  const sessionId = uuidv4();
  const sessionDir = path.join(tempDir, sessionId);

  try {
    // Validate request
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    if (!req.body.targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }

    if (!validateSize(req.body.targetSize)) {
      return res.status(400).json({ error: 'Invalid targetSize format. Use WIDTHxHEIGHT (e.g., 500x500)' });
    }

    const delay = req.body.delay ? parseInt(req.body.delay, 10) : 10;
    if (isNaN(delay) || delay < 0 || delay > 10000) {
      return res.status(400).json({ error: 'Invalid delay. Must be a number between 0 and 10000' });
    }

    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

    // Create session directory
    fs.mkdirSync(sessionDir, { recursive: true });

    // Save uploaded images to disk
    const imagePaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const imagePath = path.join(sessionDir, `image_${i}.png`);
      fs.writeFileSync(imagePath, file.buffer);
      imagePaths.push(imagePath);
    }

    // Prepare image list for ImageMagick
    let imageList = imagePaths.join(' ');
    
    // If appendReverted is true, add reversed images
    if (appendReverted) {
      const reversedPaths = imagePaths.slice().reverse();
      imageList += ' ' + reversedPaths.join(' ');
    }

    // Output GIF path
    const outputGifPath = path.join(sessionDir, 'output.gif');

    // Build ImageMagick convert command
    const size = parseSize(req.body.targetSize);
    const delayValue = Math.max(1, Math.floor(delay / 10)); // Convert ms to centiseconds
    
    const command = `convert -delay ${delayValue} -loop 0 ${imageList} -resize ${req.body.targetSize}! "${outputGifPath}"`;

    // Execute ImageMagick command
    try {
      execSync(command, { 
        stdio: 'pipe',
        timeout: 60000 // 60 second timeout
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create GIF. Invalid images or processing error.' });
    }

    // Check if output file was created
    if (!fs.existsSync(outputGifPath)) {
      return res.status(500).json({ error: 'Failed to create GIF output file' });
    }

    // Read the GIF file
    const gifBuffer = fs.readFileSync(outputGifPath);

    // Set response headers
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Length', gifBuffer.length);
    res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');

    // Send the GIF
    res.send(gifBuffer);

  } catch (error) {
    console.error('Error:', error);
    
    // Handle multer errors
    if (error.message.includes('Invalid file type')) {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds maximum limit of 50MB' });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum 100 files allowed' });
    }

    return res.status(500).json({ error: 'Internal server error' });

  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GIF Creator API listening on http://0.0.0.0:${PORT}`);
});