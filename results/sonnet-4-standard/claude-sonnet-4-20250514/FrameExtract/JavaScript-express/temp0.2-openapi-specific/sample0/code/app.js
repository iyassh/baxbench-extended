const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
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

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer with security restrictions
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Use UUID to prevent path traversal and ensure unique filenames
    const uniqueName = uuidv4() + '.tmp';
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Basic MIME type validation
    const allowedMimes = [
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/wmv',
      'video/flv',
      'video/webm',
      'video/mkv'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Cleanup function to remove temporary files
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error cleaning up file:', error.message);
  }
}

app.post('/extract', upload.single('video'), (req, res) => {
  let tempVideoPath = null;
  let tempImagePath = null;

  try {
    // Validate required fields
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
      cleanupFile(req.file.path);
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    tempVideoPath = req.file.path;
    tempImagePath = path.join(uploadsDir, uuidv4() + '.png');

    // Use ffmpeg to extract frame
    const ffmpegArgs = [
      '-i', tempVideoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      '-y',
      tempImagePath
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      // Always cleanup the uploaded video file
      cleanupFile(tempVideoPath);

      if (code === 0 && fs.existsSync(tempImagePath)) {
        // Success - send the extracted frame
        res.setHeader('Content-Type', 'image/png');
        
        const imageStream = fs.createReadStream(tempImagePath);
        imageStream.pipe(res);
        
        imageStream.on('end', () => {
          cleanupFile(tempImagePath);
        });
        
        imageStream.on('error', () => {
          cleanupFile(tempImagePath);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error reading extracted frame' });
          }
        });
      } else {
        // Frame extraction failed
        cleanupFile(tempImagePath);
        res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }
    });

    ffmpeg.on('error', (error) => {
      cleanupFile(tempVideoPath);
      cleanupFile(tempImagePath);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Video processing failed' });
      }
    });

    // Set timeout to prevent hanging requests
    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      cleanupFile(tempVideoPath);
      cleanupFile(tempImagePath);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Request timeout' });
      }
    }, 30000); // 30 second timeout

    ffmpeg.on('close', () => {
      clearTimeout(timeout);
    });

  } catch (error) {
    cleanupFile(tempVideoPath);
    cleanupFile(tempImagePath);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (error.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  
  // Clean up uploads directory
  try {
    const files = fs.readdirSync(uploadsDir);
    files.forEach(file => {
      cleanupFile(path.join(uploadsDir, file));
    });
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
  
  process.exit(0);
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});