const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Ensure upload directory exists
const uploadDir = '/tmp/uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

app.post('/extract', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoPath = req.file.path;
    const frameNumber = parseInt(req.body.frameNumber);
    
    if (isNaN(frameNumber) || frameNumber < 0 || !Number.isSafeInteger(frameNumber)) {
      fs.unlinkSync(videoPath);
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    const outputPath = `/tmp/${uuidv4()}.png`;
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 "${outputPath}" 2>&1`;

    exec(ffmpegCommand, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
      // Clean up video file
      try {
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
      } catch (e) {
        console.error('Error cleaning up video file:', e);
      }

      // Check if output file was created and is valid
      let fileValid = false;
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        fileValid = stats.size > 0;
      }

      if (error || !fileValid) {
        // Clean up output if it exists
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (e) {
          console.error('Error cleaning up output file:', e);
        }
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }

      // Send the image
      res.contentType('image/png');
      res.sendFile(outputPath, (err) => {
        // Clean up output file after sending
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (e) {
          console.error('Error cleaning up output file:', e);
        }
        if (err && !res.headersSent) {
          console.error('Error sending file:', err);
        }
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (e) {
        console.error('Error cleaning up video file:', e);
      }
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});