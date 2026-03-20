const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const app = express();
const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configure multer for memory storage with limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
    files: 1,
    fields: 2
  },
  fileFilter: (req, file, cb) => {
    // Only accept video files
    const allowedMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/webm'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
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

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Cleanup function for temporary files
const cleanupFiles = async (files) => {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        await unlinkAsync(file);
      }
    } catch (err) {
      console.error(`Failed to delete temp file: ${path.basename(file)}`);
    }
  }
};

app.post('/extract', upload.single('video'), async (req, res) => {
  let tempVideoPath = null;
  let tempImagePath = null;
  
  try {
    // Validate input
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number' });
    }
    
    // Limit frame number to prevent excessive resource usage
    if (frameNumber > 100000) {
      return res.status(400).json({ error: 'Frame number too large' });
    }
    
    // Generate secure random filenames
    const randomId = crypto.randomBytes(16).toString('hex');
    tempVideoPath = path.join(tempDir, `video_${randomId}.tmp`);
    tempImagePath = path.join(tempDir, `frame_${randomId}.png`);
    
    // Write video to temp file
    await promisify(fs.writeFile)(tempVideoPath, req.file.buffer);
    
    // Construct ffmpeg command with proper escaping
    const ffmpegCommand = [
      'ffmpeg',
      '-i', tempVideoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      '-y',
      tempImagePath
    ].join(' ');
    
    // Execute ffmpeg with timeout
    try {
      await execAsync(ffmpegCommand, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB max buffer
      });
    } catch (execError) {
      // Check if frame extraction failed
      if (!fs.existsSync(tempImagePath) || fs.statSync(tempImagePath).size === 0) {
        await cleanupFiles([tempVideoPath, tempImagePath]);
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }
      // If file exists but there was an error, it might be a warning
      console.error('FFmpeg warning:', execError.message);
    }
    
    // Check if image was created
    if (!fs.existsSync(tempImagePath)) {
      await cleanupFiles([tempVideoPath, tempImagePath]);
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }
    
    // Read and send the image
    const imageBuffer = await promisify(fs.readFile)(tempImagePath);
    
    // Clean up temp files
    await cleanupFiles([tempVideoPath, tempImagePath]);
    
    // Send the image
    res.setHeader('Content-Type', 'image/png');
    res.send(imageBuffer);
    
  } catch (error) {
    // Clean up temp files on error
    if (tempVideoPath || tempImagePath) {
      await cleanupFiles([tempVideoPath, tempImagePath].filter(Boolean));
    }
    
    // Log error internally without exposing details
    console.error('Error processing request:', error.message);
    
    // Send generic error response
    if (error.message && error.message.includes('Invalid file type')) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    res.status(500).json({ error: 'An error occurred while processing the video' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An internal error occurred' });
});

// Periodic cleanup of old temp files (older than 1 hour)
setInterval(() => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        
        if (now - stats.mtimeMs > 3600000) { // 1 hour
          fs.unlink(filePath, (err) => {
            if (err) console.error(`Failed to delete old temp file: ${file}`);
          });
        }
      });
    });
  });
}, 600000); // Run every 10 minutes

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});