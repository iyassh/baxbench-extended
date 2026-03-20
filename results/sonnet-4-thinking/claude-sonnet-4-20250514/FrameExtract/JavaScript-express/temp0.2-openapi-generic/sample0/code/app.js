const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer for file uploads
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept video files
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  }
});

app.post('/extract', upload.single('video'), (req, res) => {
  let videoPath = null;
  let outputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const { videoFileName, frameNumber } = req.body;
    
    // Validate and sanitize frameNumber
    const frameNum = parseInt(frameNumber, 10);
    if (isNaN(frameNum) || frameNum < 0 || frameNum > 1000000) {
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    videoPath = req.file.path;
    outputPath = path.join(os.tmpdir(), `frame_${uuidv4()}.png`);

    try {
      // Use ffmpeg to extract frame - frameNum is guaranteed to be a safe integer
      const command = `ffmpeg -i "${videoPath}" -vf 'select=eq(n,${frameNum})' -vframes 1 "${outputPath}" -y`;
      execSync(command, {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 30000 // 30 second timeout
      });

      // Check if output file was created and has content
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        return res.status(404).json({ 
          error: `Frame at index ${frameNum} could not be found.` 
        });
      }

      // Send the image
      res.set('Content-Type', 'image/png');
      const imageData = fs.readFileSync(outputPath);
      res.send(imageData);

    } catch (error) {
      return res.status(404).json({ 
        error: `Frame at index ${frameNum} could not be found.` 
      });
    }

  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Clean up files
    if (videoPath && fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
      } catch (e) {
        console.error('Failed to cleanup video file:', e);
      }
    }
    if (outputPath && fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        console.error('Failed to cleanup output file:', e);
      }
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  return res.status(400).json({ error: error.message });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});