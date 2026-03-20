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

// Configure multer for file uploads with size limits
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1,
    fields: 10
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

// Cleanup function to remove temporary files
async function cleanup(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) {
        await unlinkAsync(file);
      }
    } catch (err) {
      // Log error but don't expose it to user
      console.error('Cleanup error:', err.message);
    }
  }
}

app.post('/extract', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let outputPath = null;

  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Parse and validate frame number
    const frameNumber = parseInt(req.body.frameNumber, 10);
    if (isNaN(frameNumber) || frameNumber < 0 || frameNumber > 1000000) {
      await cleanup(req.file.path);
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    // Generate safe output filename
    const outputFilename = `frame_${crypto.randomBytes(16).toString('hex')}.png`;
    outputPath = path.join('/tmp/uploads/', outputFilename);
    videoPath = req.file.path;

    // Construct ffmpeg command with proper escaping
    const command = [
      'ffmpeg',
      '-i', videoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      '-y',
      outputPath
    ].join(' ');

    // Execute ffmpeg with timeout
    try {
      await execAsync(command, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 // 1MB buffer limit
      });
    } catch (error) {
      await cleanup(videoPath, outputPath);
      
      // Check if frame doesn't exist
      if (error.message.includes('Output file is empty') || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }
      
      // Generic error response without exposing details
      return res.status(500).json({ error: 'Failed to extract frame' });
    }

    // Check if output file exists and has content
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      await cleanup(videoPath, outputPath);
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Send the image file
    res.setHeader('Content-Type', 'image/png');
    const stream = fs.createReadStream(outputPath);
    
    stream.on('end', async () => {
      await cleanup(videoPath, outputPath);
    });
    
    stream.on('error', async (err) => {
      console.error('Stream error:', err.message);
      await cleanup(videoPath, outputPath);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to send image' });
      }
    });
    
    stream.pipe(res);

  } catch (error) {
    // Clean up files on any error
    await cleanup(videoPath, outputPath);
    
    // Log error internally but don't expose details
    console.error('Error processing request:', error.message);
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  
  // Clean up any uploaded files
  if (req.file && req.file.path) {
    cleanup(req.file.path).catch(() => {});
  }
  
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server closed');
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Server closed');
  });
});