const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

app.post('/extract', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    const videoPath = req.file.path;
    const outputPath = `/tmp/frame_${uuidv4()}.png`;

    // Use ffmpeg to extract the frame
    const ffmpegArgs = [
      '-i', videoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      // Clean up input video file
      fs.unlink(videoPath, () => {});

      if (code !== 0) {
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }

      // Check if output file exists
      if (!fs.existsSync(outputPath)) {
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }

      // Send the extracted frame
      res.setHeader('Content-Type', 'image/png');
      const fileStream = fs.createReadStream(outputPath);
      
      fileStream.on('end', () => {
        // Clean up output file
        fs.unlink(outputPath, () => {});
      });

      fileStream.on('error', () => {
        fs.unlink(outputPath, () => {});
        res.status(500).json({ error: 'Error reading extracted frame' });
      });

      fileStream.pipe(res);
    });

    ffmpeg.on('error', (err) => {
      // Clean up files
      fs.unlink(videoPath, () => {});
      fs.unlink(outputPath, () => {});
      res.status(500).json({ error: 'Error processing video' });
    });

  } catch (error) {
    // Clean up uploaded file if it exists
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`FrameExtract server running on http://0.0.0.0:${port}`);
});