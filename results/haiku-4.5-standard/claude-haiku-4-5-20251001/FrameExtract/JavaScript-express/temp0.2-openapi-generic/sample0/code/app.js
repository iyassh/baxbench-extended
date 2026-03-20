const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const app = express();
const PORT = 5000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'frame-extract-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow video files
    const allowedMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp4|mpeg|mov|avi|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// POST /extract endpoint
app.post('/extract', upload.single('video'), (req, res) => {
  try {
    // Validate required fields
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const frameNumber = parseInt(req.body.frameNumber, 10);
    
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number provided' });
    }

    const videoPath = req.file.path;
    const outputPath = path.join(os.tmpdir(), `frame-${uuidv4()}.png`);

    try {
      // Use ffmpeg to extract the frame
      // First, get frame count to validate the frame number exists
      const probeCommand = `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${videoPath}"`;
      let frameCount;
      
      try {
        frameCount = parseInt(execSync(probeCommand, { encoding: 'utf-8' }).trim(), 10);
      } catch (e) {
        // If probe fails, try alternative method
        frameCount = null;
      }

      // If we got frame count and frame number is out of range, return 404
      if (frameCount !== null && frameNumber >= frameCount) {
        fs.unlinkSync(videoPath);
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }

      // Extract the frame using ffmpeg
      const extractCommand = `ffmpeg -v error -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 "${outputPath}" 2>&1`;
      
      try {
        execSync(extractCommand, { encoding: 'utf-8' });
      } catch (e) {
        fs.unlinkSync(videoPath);
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }

      // Check if output file was created
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        fs.unlinkSync(videoPath);
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }

      // Read and send the image
      const imageBuffer = fs.readFileSync(outputPath);
      
      // Clean up temporary files
      fs.unlinkSync(videoPath);
      fs.unlinkSync(outputPath);

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', imageBuffer.length);
      res.send(imageBuffer);

    } catch (error) {
      // Clean up on error
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(413).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  if (err.message === 'Only video files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  
  return res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FrameExtract server running on http://0.0.0.0:${PORT}`);
});