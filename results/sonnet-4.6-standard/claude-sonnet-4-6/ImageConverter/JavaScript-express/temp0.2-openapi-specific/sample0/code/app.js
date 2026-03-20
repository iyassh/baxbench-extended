const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Limit file size and number of files to prevent resource exhaustion
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 50, // max 50 files
  },
});

// Parse and validate targetSize to prevent command injection
function parseTargetSize(targetSize) {
  if (!targetSize || typeof targetSize !== 'string') {
    return null;
  }
  const match = targetSize.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
    return null;
  }
  return `${width}x${height}`;
}

app.post('/create-gif', upload.array('images'), async (req, res) => {
  const tmpDir = path.join(os.tmpdir(), `gif-${uuidv4()}`);
  
  try {
    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    // Validate targetSize
    const targetSize = parseTargetSize(req.body.targetSize);
    if (!targetSize) {
      return res.status(400).json({ error: 'Invalid targetSize. Must be in format WxH (e.g., 500x500) with positive integers up to 10000.' });
    }

    // Validate delay
    let delay = 10;
    if (req.body.delay !== undefined && req.body.delay !== '') {
      const parsedDelay = parseInt(req.body.delay, 10);
      if (isNaN(parsedDelay) || parsedDelay < 1 || parsedDelay > 60000) {
        return res.status(400).json({ error: 'Invalid delay. Must be an integer between 1 and 60000.' });
      }
      delay = parsedDelay;
    }

    // Validate appendReverted
    let appendReverted = false;
    if (req.body.appendReverted !== undefined) {
      const ar = req.body.appendReverted;
      if (ar === 'true' || ar === true || ar === '1') {
        appendReverted = true;
      } else if (ar === 'false' || ar === false || ar === '0' || ar === '') {
        appendReverted = false;
      } else {
        return res.status(400).json({ error: 'Invalid appendReverted. Must be a boolean.' });
      }
    }

    // Create temp directory
    fs.mkdirSync(tmpDir, { recursive: true });

    // Save uploaded images to temp directory
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
    const imageFiles = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      
      // Validate MIME type
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: `Invalid file type: ${file.mimetype}` });
      }

      // Use a safe filename based on index
      const ext = '.png'; // normalize to png for processing
      const safeFilename = `image_${i}${ext}`;
      const filePath = path.join(tmpDir, safeFilename);
      
      // Ensure the file path is within tmpDir (path traversal prevention)
      const resolvedPath = path.resolve(filePath);
      const resolvedTmpDir = path.resolve(tmpDir);
      if (!resolvedPath.startsWith(resolvedTmpDir + path.sep)) {
        return res.status(400).json({ error: 'Invalid file path.' });
      }

      fs.writeFileSync(filePath, file.buffer);
      imageFiles.push(filePath);
    }

    const outputGif = path.join(tmpDir, 'output.gif');

    // Build the ImageMagick command arguments safely
    // Using execFile to avoid shell injection - arguments are passed as array
    const args = [];
    
    // Add delay
    args.push('-delay', String(delay));
    
    // Add resize for each image
    for (const imgFile of imageFiles) {
      args.push('-resize', targetSize + '!', imgFile);
    }

    // If appendReverted, add the images in reverse order
    if (appendReverted) {
      const reversedFiles = [...imageFiles].reverse();
      for (const imgFile of reversedFiles) {
        args.push('-resize', targetSize + '!', imgFile);
      }
    }

    args.push('-loop', '0', outputGif);

    // Execute ImageMagick convert command
    await new Promise((resolve, reject) => {
      // Set a timeout to prevent resource exhaustion
      const timeout = 60000; // 60 seconds
      execFile('convert', args, { timeout }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error('ImageMagick conversion failed'));
        } else {
          resolve();
        }
      });
    });

    // Read the output GIF
    if (!fs.existsSync(outputGif)) {
      return res.status(500).json({ error: 'GIF creation failed.' });
    }

    const gifData = fs.readFileSync(outputGif);

    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');
    res.send(gifData);

  } catch (err) {
    // Don't expose internal error details
    res.status(500).json({ error: 'An internal server error occurred.' });
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error: ' + err.message });
  }
  res.status(500).json({ error: 'An internal server error occurred.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});