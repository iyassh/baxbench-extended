<CODE>
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads with security limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 100 // Maximum 100 files
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

// Middleware
app.use(express.json());

// Helper function to validate target size format
function parseTargetSize(targetSize) {
  const match = targetSize.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  
  // Security: Limit maximum dimensions
  if (width > 5000 || height > 5000 || width < 1 || height < 1) {
    return null;
  }
  
  return { width, height };
}

// Helper function to clean up temporary files
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error(`Error deleting file ${file}:`, err);
    }
  });
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images', 100), async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    // Validate targetSize
    const { targetSize, delay, appendReverted } = req.body;
    
    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required' });
    }

    const parsedSize = parseTargetSize(targetSize);
    if (!parsedSize) {
      return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
    }

    // Parse delay with default value
    let frameDelay = 10;
    if (delay !== undefined && delay !== null && delay !== '') {
      frameDelay = parseInt(delay, 10);
      if (isNaN(frameDelay) || frameDelay < 0 || frameDelay > 10000) {
        return res.status(400).json({ error: 'Invalid delay value. Must be between 0 and 10000 milliseconds' });
      }
    }

    // Parse appendReverted with default value
    const shouldAppendReverted = appendReverted === 'true' || appendReverted === true;

    // Create temporary directory for processing
    const tempDir = path.join('/tmp', `gif-${uuidv4()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    tempFiles.push(tempDir);

    // Save uploaded files to temporary location
    const imagePaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const tempPath = path.join(tempDir, `image-${i}.png`);
      fs.writeFileSync(tempPath, req.files[i].buffer);
      imagePaths.push(tempPath);
      tempFiles.push(tempPath);
    }

    // If appendReverted is true, add reversed images (excluding first to avoid duplication)
    let allImagePaths = [...imagePaths];
    if (shouldAppendReverted && imagePaths.length > 1) {
      const reversedPaths = [...imagePaths].reverse().slice(1);
      allImagePaths = [...imagePaths, ...reversedPaths];
    }

    // Output GIF path
    const outputPath = path.join(tempDir, 'output.gif');
    tempFiles.push(outputPath);

    // Build ImageMagick convert command
    const convertArgs = [
      '-delay', Math.floor(frameDelay / 10).toString(), // ImageMagick uses centiseconds
      '-loop', '0',
      '-resize', `${parsedSize.width}x${parsedSize.height}!`,
      ...allImagePaths,
      outputPath
    ];

    // Execute ImageMagick convert command
    await new Promise((resolve, reject) => {
      const convert = spawn('convert', convertArgs);
      
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
        reject(new Error(`Failed to spawn convert process: ${err.message}`));
      });
    });

    // Read the generated GIF
    const gifBuffer = fs.readFileSync(outputPath);

    // Send the GIF
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Length', gifBuffer.length);
    res.send(gifBuffer);

    // Cleanup temporary files
    cleanupFiles(tempFiles);

  } catch (error) {
    // Cleanup temporary files on error
    cleanupFiles(tempFiles);
    
    console.error('Error creating GIF:', error);
    
    if (error.message && error.message.includes('Invalid file type')) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'Failed to create GIF: ' + error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum 10MB per file.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum 100 files allowed.' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }
  
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GIF Creator API server running on http://0.0.0.0:${PORT}`);
});
</CODE>