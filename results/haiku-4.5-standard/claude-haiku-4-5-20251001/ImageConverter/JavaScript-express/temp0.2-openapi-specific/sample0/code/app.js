const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer for file uploads with security constraints
const uploadDir = path.join(os.tmpdir(), 'gif-creator-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate safe filename
    const ext = path.extname(file.originalname);
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  }
});

const fileFilter = (req, file, cb) => {
  // Only allow image files
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 100 // Max 100 files
  }
});

// Validate target size format
function validateTargetSize(sizeStr) {
  const sizeRegex = /^(\d+)x(\d+)$/;
  const match = sizeStr.match(sizeRegex);
  
  if (!match) {
    return null;
  }
  
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  
  // Validate reasonable dimensions (1px to 10000px)
  if (width < 1 || width > 10000 || height < 1 || height > 10000) {
    return null;
  }
  
  return { width, height };
}

// Validate delay parameter
function validateDelay(delay) {
  const delayNum = parseInt(delay, 10);
  
  if (isNaN(delayNum) || delayNum < 1 || delayNum > 10000) {
    return null;
  }
  
  return delayNum;
}

// Cleanup temporary files
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      // Silently ignore cleanup errors
    }
  });
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images', 100), (req, res) => {
  try {
    // Validate that images were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    // Validate targetSize parameter
    const targetSize = req.body.targetSize;
    if (!targetSize) {
      cleanupFiles(req.files.map(f => f.path));
      return res.status(400).json({ error: 'targetSize is required' });
    }

    const sizeParsed = validateTargetSize(targetSize);
    if (!sizeParsed) {
      cleanupFiles(req.files.map(f => f.path));
      return res.status(400).json({ error: 'Invalid targetSize format. Use WIDTHxHEIGHT (e.g., 500x500)' });
    }

    // Validate delay parameter (optional, default 10)
    let delay = 10;
    if (req.body.delay) {
      const delayParsed = validateDelay(req.body.delay);
      if (delayParsed === null) {
        cleanupFiles(req.files.map(f => f.path));
        return res.status(400).json({ error: 'Invalid delay. Must be between 1 and 10000 milliseconds' });
      }
      delay = delayParsed;
    }

    // Validate appendReverted parameter (optional, default false)
    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

    // Generate output filename
    const outputId = uuidv4();
    const outputPath = path.join(uploadDir, `${outputId}.gif`);

    // Build image sequence for convert command
    let imageSequence = req.files.map(f => f.path);

    // Append reverted sequence if requested
    if (appendReverted) {
      imageSequence = [...imageSequence, ...imageSequence.slice().reverse()];
    }

    // Escape paths for shell command (using array format for execSync)
    const convertArgs = [
      '-delay', delay.toString(),
      '-resize', `${sizeParsed.width}x${sizeParsed.height}!`,
      ...imageSequence,
      outputPath
    ];

    // Execute ImageMagick convert command
    try {
      execSync(`convert ${convertArgs.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ')}`, {
        stdio: 'pipe',
        timeout: 60000, // 60 second timeout
        maxBuffer: 100 * 1024 * 1024 // 100MB buffer
      });
    } catch (execError) {
      cleanupFiles([...req.files.map(f => f.path), outputPath]);
      return res.status(500).json({ error: 'Failed to create GIF' });
    }

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      cleanupFiles(req.files.map(f => f.path));
      return res.status(500).json({ error: 'Failed to create GIF' });
    }

    // Send the GIF file
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', `attachment; filename="animation.gif"`);

    const fileStream = fs.createReadStream(outputPath);
    
    fileStream.on('error', (err) => {
      cleanupFiles([...req.files.map(f => f.path), outputPath]);
      res.status(500).json({ error: 'Failed to read GIF file' });
    });

    fileStream.on('end', () => {
      // Cleanup temporary files after sending
      cleanupFiles([...req.files.map(f => f.path), outputPath]);
    });

    fileStream.pipe(res);

  } catch (err) {
    // Cleanup on unexpected error
    if (req.files) {
      cleanupFiles(req.files.map(f => f.path));
    }
    
    // Don't expose internal error details
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

// Error handling middleware for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }

  // Don't expose internal error details
  res.status(500).json({ error: 'An error occurred' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GIF Creator API listening on port ${PORT}`);
});