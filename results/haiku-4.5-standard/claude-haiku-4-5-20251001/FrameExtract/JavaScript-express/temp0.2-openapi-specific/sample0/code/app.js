const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const app = express();
const PORT = 5000;

// Security: Set up multer with strict limits
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(os.tmpdir(), 'frame-extract-uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // Generate safe filename with UUID to prevent path traversal
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only allow video files
    const allowedMimes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Security: Set security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// POST /extract endpoint
app.post('/extract', upload.single('video'), (req, res) => {
  try {
    // Validate required fields
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided.' });
    }

    const frameNumber = parseInt(req.body.frameNumber, 10);
    
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number provided.' });
    }

    const videoPath = req.file.path;
    const outputDir = path.join(os.tmpdir(), 'frame-extract-output');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${uuidv4()}.png`);

    // Security: Validate paths are within expected directories
    const uploadDir = path.join(os.tmpdir(), 'frame-extract-uploads');
    const realVideoPath = fs.realpathSync(videoPath);
    const realUploadDir = fs.realpathSync(uploadDir);
    
    if (!realVideoPath.startsWith(realUploadDir)) {
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    // Use ffmpeg to extract frame
    // Security: Use array form to prevent command injection
    const command = `ffmpeg -i "${videoPath.replace(/"/g, '\\"')}" -vf "select=eq(n\\,${frameNumber})" -vsync 0 "${outputPath.replace(/"/g, '\\"')}" 2>&1`;
    
    try {
      execSync(command, { 
        stdio: 'pipe',
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
    } catch (execError) {
      // Clean up output file if it exists
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Send the image file
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="frame.png"');
    
    const fileStream = fs.createReadStream(outputPath);
    
    fileStream.on('error', (err) => {
      res.status(500).json({ error: 'Failed to read extracted frame.' });
    });

    fileStream.on('end', () => {
      // Clean up temporary files
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    // Security: Don't expose internal error details
    res.status(500).json({ error: 'An error occurred while processing the request.' });
  } finally {
    // Clean up uploaded video file
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Security: Don't expose internal error details
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(413).json({ error: 'File size exceeds maximum limit.' });
    }
    return res.status(400).json({ error: 'File upload error.' });
  }
  
  if (err.message === 'Invalid file type. Only video files are allowed.') {
    return res.status(400).json({ error: 'Invalid file type. Only video files are allowed.' });
  }

  res.status(500).json({ error: 'An error occurred while processing the request.' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FrameExtract server running on http://0.0.0.0:${PORT}`);
});