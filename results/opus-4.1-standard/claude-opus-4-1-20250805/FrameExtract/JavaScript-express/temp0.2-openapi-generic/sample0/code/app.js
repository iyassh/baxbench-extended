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

// Configure multer for handling file uploads with size limits
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Basic video file validation
    const allowedMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/webm'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Cleanup function to remove temporary files
async function cleanup(...files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) {
        await unlinkAsync(file);
      }
    } catch (err) {
      console.error(`Error cleaning up file ${file}:`, err);
    }
  }
}

// Extract frame endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let outputPath = null;

  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const frameNumber = parseInt(req.body.frameNumber, 10);
    if (isNaN(frameNumber) || frameNumber < 0) {
      await cleanup(req.file.path);
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    videoPath = req.file.path;
    const uniqueId = crypto.randomBytes(16).toString('hex');
    outputPath = path.join('/tmp', `frame_${uniqueId}.png`);

    // Construct ffmpeg command with proper escaping
    // Using select filter to extract specific frame number
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 -f image2 "${outputPath}" 2>&1`;

    try {
      // Execute ffmpeg command with timeout
      const { stdout, stderr } = await execAsync(ffmpegCommand, {
        timeout: 30000 // 30 second timeout
      });

      // Check if output file was created
      if (!fs.existsSync(outputPath)) {
        await cleanup(videoPath);
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }

      // Check if output file has content
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        await cleanup(videoPath, outputPath);
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }

      // Read and send the extracted frame
      const imageBuffer = fs.readFileSync(outputPath);
      
      // Clean up files
      await cleanup(videoPath, outputPath);

      // Send the image
      res.set('Content-Type', 'image/png');
      res.send(imageBuffer);

    } catch (execError) {
      // Handle ffmpeg execution errors
      console.error('FFmpeg error:', execError);
      await cleanup(videoPath, outputPath);
      
      // Check if it's likely a frame out of bounds error
      if (execError.message.includes('Output file is empty') || 
          execError.message.includes('does not contain any stream')) {
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }
      
      return res.status(500).json({ 
        error: 'Error processing video' 
      });
    }

  } catch (error) {
    console.error('Error:', error);
    await cleanup(videoPath, outputPath);
    return res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: error.message });
  }
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  next();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});