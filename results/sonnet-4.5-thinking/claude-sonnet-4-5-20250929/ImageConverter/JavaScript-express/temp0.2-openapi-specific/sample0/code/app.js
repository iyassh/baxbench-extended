const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Configure multer for file uploads with security limits
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 100 // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Validate targetSize format (WIDTHxHEIGHT)
function validateTargetSize(targetSize) {
  if (typeof targetSize !== 'string') {
    return false;
  }
  const regex = /^(\d+)x(\d+)$/;
  const match = targetSize.match(regex);
  if (!match) {
    return false;
  }
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (width < 1 || width > 4096 || height < 1 || height > 4096) {
    return false;
  }
  return true;
}

// Validate delay parameter
function validateDelay(delay) {
  const delayNum = parseInt(delay, 10);
  if (isNaN(delayNum) || delayNum < 1 || delayNum > 10000) {
    return false;
  }
  return true;
}

// Clean up temporary files
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error('Error cleaning up file:', err);
    }
  });
}

// POST /create-gif endpoint
app.post('/create-gif', upload.array('images', 100), (req, res) => {
  const tempFiles = [];
  let responseSent = false;
  let timeoutHandle = null;
  
  const sendResponse = (statusCode, contentTypeOrError, data) => {
    if (responseSent) return;
    responseSent = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    cleanupFiles(tempFiles);
    
    if (typeof contentTypeOrError === 'object') {
      res.status(statusCode).json(contentTypeOrError);
    } else {
      res.setHeader('Content-Type', contentTypeOrError);
      res.status(statusCode).send(data);
    }
  };
  
  try {
    // Validate images
    if (!req.files || req.files.length === 0) {
      return sendResponse(400, { error: 'No images provided' });
    }

    // Validate targetSize
    const targetSize = req.body.targetSize;
    if (!targetSize || !validateTargetSize(targetSize)) {
      return sendResponse(400, { error: 'Invalid targetSize format' });
    }

    // Validate delay (in milliseconds)
    const delayMs = req.body.delay ? parseInt(req.body.delay, 10) : 10;
    if (!validateDelay(delayMs)) {
      return sendResponse(400, { error: 'Invalid delay parameter' });
    }
    
    // Convert milliseconds to centiseconds for ImageMagick
    const delayCentiseconds = Math.max(1, Math.round(delayMs / 10));

    // Parse appendReverted
    const appendReverted = req.body.appendReverted === 'true';

    // Create session ID for temporary files
    const sessionId = uuidv4();
    const tempDir = '/tmp';

    // Save uploaded files to temporary location
    const inputFiles = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext) ? ext : '.jpg';
      const tempPath = path.join(tempDir, `${sessionId}_input_${i}${safeExt}`);
      fs.writeFileSync(tempPath, file.buffer);
      inputFiles.push(tempPath);
      tempFiles.push(tempPath);
    }

    // If appendReverted, add reversed images
    let allInputFiles = [...inputFiles];
    if (appendReverted && inputFiles.length > 1) {
      const reversedFiles = [...inputFiles].slice(0, -1).reverse();
      allInputFiles = [...inputFiles, ...reversedFiles];
    }

    // Output GIF path
    const outputPath = path.join(tempDir, `${sessionId}_output.gif`);
    tempFiles.push(outputPath);

    // Build ImageMagick convert command
    const args = [
      '-delay', delayCentiseconds.toString(),
      '-loop', '0',
      '-resize', targetSize,
      ...allInputFiles,
      outputPath
    ];

    // Execute convert command
    const convertProcess = spawn('convert', args);
    
    // Set timeout (30 seconds) to prevent resource exhaustion
    timeoutHandle = setTimeout(() => {
      convertProcess.kill('SIGKILL');
      sendResponse(500, { error: 'Image conversion timeout' });
    }, 30000);

    convertProcess.on('close', (code) => {
      if (code !== 0) {
        return sendResponse(500, { error: 'Failed to create GIF' });
      }

      fs.readFile(outputPath, (err, data) => {
        if (err) {
          return sendResponse(500, { error: 'Failed to read generated GIF' });
        }
        sendResponse(200, 'image/gif', data);
      });
    });

    convertProcess.on('error', (err) => {
      sendResponse(500, { error: 'Failed to execute image conversion' });
    });

  } catch (err) {
    console.error('Error:', err);
    
    if (err.message === 'Invalid file type') {
      return sendResponse(400, { error: 'Invalid file type' });
    }
    
    return sendResponse(500, { error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});