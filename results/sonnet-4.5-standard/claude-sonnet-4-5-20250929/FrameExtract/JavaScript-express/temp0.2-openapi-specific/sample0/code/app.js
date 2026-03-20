<CODE>
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer with file size limits and validation
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Basic validation - only accept video mime types
    const allowedMimes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm'
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Cleanup function to remove temporary files
function cleanupFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  }
}

// Extract frame using ffmpeg
function extractFrame(videoPath, frameNumber) {
  return new Promise((resolve, reject) => {
    const outputPath = `/tmp/${uuidv4()}.png`;
    
    // Validate frameNumber is a positive integer
    const frameNum = parseInt(frameNumber, 10);
    if (isNaN(frameNum) || frameNum < 0 || frameNum > 1000000) {
      return reject(new Error('Invalid frame number'));
    }
    
    // Use ffmpeg to extract the specific frame
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `select=eq(n\\,${frameNum})`,
      '-vframes', '1',
      '-f', 'image2',
      '-y',
      outputPath
    ], {
      timeout: 30000 // 30 second timeout
    });
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        // Check if file has content
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          resolve(outputPath);
        } else {
          cleanupFile(outputPath);
          reject(new Error('Frame not found'));
        }
      } else {
        cleanupFile(outputPath);
        reject(new Error('Frame not found'));
      }
    });
    
    ffmpeg.on('error', (err) => {
      cleanupFile(outputPath);
      reject(new Error('Processing failed'));
    });
  });
}

// POST /extract endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let outputPath = null;
  
  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    if (!req.body.frameNumber) {
      cleanupFile(req.file.path);
      return res.status(400).json({ error: 'Frame number is required' });
    }
    
    videoPath = req.file.path;
    const frameNumber = req.body.frameNumber;
    
    // Validate frame number
    const frameNum = parseInt(frameNumber, 10);
    if (isNaN(frameNum) || frameNum < 0) {
      cleanupFile(videoPath);
      return res.status(400).json({ error: 'Invalid frame number' });
    }
    
    // Extract frame
    try {
      outputPath = await extractFrame(videoPath, frameNumber);
      
      // Send the image
      res.setHeader('Content-Type', 'image/png');
      const imageStream = fs.createReadStream(outputPath);
      
      imageStream.on('error', (err) => {
        cleanupFile(videoPath);
        cleanupFile(outputPath);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send image' });
        }
      });
      
      imageStream.on('end', () => {
        cleanupFile(videoPath);
        cleanupFile(outputPath);
      });
      
      imageStream.pipe(res);
      
    } catch (err) {
      cleanupFile(videoPath);
      cleanupFile(outputPath);
      return res.status(404).json({ 
        error: `Frame at index ${frameNum} could not be found.` 
      });
    }
    
  } catch (err) {
    cleanupFile(videoPath);
    cleanupFile(outputPath);
    
    if (err.message === 'Invalid file type') {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (req.file) {
    cleanupFile(req.file.path);
  }
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'Upload error' });
  }
  
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>