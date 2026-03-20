<CODE>
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Create temporary directory for uploads
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Configure multer with security constraints
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = uuidv4();
    const sessionDir = path.join(TEMP_DIR, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    req.sessionDir = sessionDir;
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const sanitizedName = uuidv4() + path.extname(file.originalname).toLowerCase();
    cb(null, sanitizedName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 100 // Maximum 100 files
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Cleanup function
function cleanupDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      files.forEach(file => {
        const filePath = path.join(dirPath, file);
        fs.unlinkSync(filePath);
      });
      fs.rmdirSync(dirPath);
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

// Validate target size
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
  
  if (width < 1 || width > 4000 || height < 1 || height > 4000) {
    return null;
  }
  
  return { width, height };
}

// Validate delay
function validateDelay(delay) {
  const delayNum = parseInt(delay, 10);
  if (isNaN(delayNum) || delayNum < 1 || delayNum > 10000) {
    return 10;
  }
  return delayNum;
}

app.post('/create-gif', upload.array('images', 100), async (req, res) => {
  let sessionDir = req.sessionDir;
  
  try {
    // Validate images
    if (!req.files || req.files.length === 0) {
      if (sessionDir) cleanupDirectory(sessionDir);
      return res.status(400).json({ error: 'No images provided' });
    }
    
    // Validate targetSize
    const sizeValidation = validateTargetSize(req.body.targetSize);
    if (!sizeValidation) {
      if (sessionDir) cleanupDirectory(sessionDir);
      return res.status(400).json({ error: 'Invalid target size format' });
    }
    
    // Validate delay
    const delay = validateDelay(req.body.delay);
    
    // Parse appendReverted
    const appendReverted = req.body.appendReverted === 'true';
    
    // Prepare file paths
    let imagePaths = req.files.map(file => file.path);
    
    // If appendReverted, add reversed images (excluding first to avoid duplicate)
    if (appendReverted && imagePaths.length > 1) {
      const reversedPaths = [...imagePaths].reverse().slice(1);
      imagePaths = imagePaths.concat(reversedPaths);
    }
    
    // Output GIF path
    const outputPath = path.join(sessionDir, 'output.gif');
    
    // Build ImageMagick command arguments
    const args = [
      '-delay', delay.toString(),
      '-loop', '0',
      '-resize', `${sizeValidation.width}x${sizeValidation.height}!`,
      ...imagePaths,
      outputPath
    ];
    
    // Execute ImageMagick convert command
    const convert = spawn('convert', args, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer
    });
    
    let stderrData = '';
    
    convert.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    convert.on('error', (err) => {
      cleanupDirectory(sessionDir);
      return res.status(500).json({ error: 'Failed to process images' });
    });
    
    convert.on('close', (code) => {
      if (code !== 0) {
        cleanupDirectory(sessionDir);
        return res.status(500).json({ error: 'Failed to create GIF' });
      }
      
      // Check if output file exists
      if (!fs.existsSync(outputPath)) {
        cleanupDirectory(sessionDir);
        return res.status(500).json({ error: 'Failed to create GIF' });
      }
      
      // Send the GIF file
      res.setHeader('Content-Type', 'image/gif');
      
      const readStream = fs.createReadStream(outputPath);
      
      readStream.on('error', () => {
        cleanupDirectory(sessionDir);
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Failed to send GIF' });
        }
      });
      
      readStream.on('end', () => {
        cleanupDirectory(sessionDir);
      });
      
      readStream.pipe(res);
    });
    
  } catch (err) {
    if (sessionDir) cleanupDirectory(sessionDir);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (req.sessionDir) {
    cleanupDirectory(req.sessionDir);
  }
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
    return res.status(400).json({ error: 'Upload error' });
  }
  
  if (err.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  return res.status(500).json({ error: 'Internal server error' });
});

// Cleanup old temp directories on startup
try {
  if (fs.existsSync(TEMP_DIR)) {
    const dirs = fs.readdirSync(TEMP_DIR);
    dirs.forEach(dir => {
      const dirPath = path.join(TEMP_DIR, dir);
      cleanupDirectory(dirPath);
    });
  }
} catch (err) {
  console.error('Startup cleanup error:', err.message);
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
</CODE>