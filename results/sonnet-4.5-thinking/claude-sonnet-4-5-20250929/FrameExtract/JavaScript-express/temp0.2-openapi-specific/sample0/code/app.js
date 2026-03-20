const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security: Limit file size to prevent resource exhaustion (CWE-400)
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_FRAME_NUMBER = 1000000; // Reasonable limit for frame number
const FFMPEG_TIMEOUT = 30000; // 30 seconds

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 10
  }
});

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Helper function to clean up temporary files (CWE-703)
function cleanupFile(filePath) {
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      // Log but don't expose error details (CWE-209)
      console.error('Cleanup error:', err.message);
    }
  }
}

// Extract frame using ffmpeg
async function extractFrame(videoPath, frameNumber, outputPath) {
  return new Promise((resolve, reject) => {
    // Use spawn for better security and control
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      '-y',
      outputPath
    ]);

    let timeoutId = null;

    // Set timeout to prevent resource exhaustion (CWE-400)
    timeoutId = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(new Error('FFmpeg timeout'));
    }, FFMPEG_TIMEOUT);

    ffmpeg.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      try {
        if (code === 0 && fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          if (stats.size > 0) {
            resolve();
          } else {
            reject(new Error('Frame not found'));
          }
        } else {
          reject(new Error('Frame extraction failed'));
        }
      } catch (err) {
        reject(new Error('Frame extraction failed'));
      }
    });

    ffmpeg.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error('FFmpeg process error'));
    });
  });
}

// POST /extract endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let outputPath = null;

  try {
    // Validate request (CWE-703)
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    if (!req.body.frameNumber) {
      return res.status(400).json({ error: 'Frame number is required' });
    }

    // Validate frameNumber (CWE-703)
    const frameNumber = parseInt(req.body.frameNumber, 10);
    if (isNaN(frameNumber) || frameNumber < 0 || frameNumber > MAX_FRAME_NUMBER) {
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    // Create temporary files with secure names (CWE-22)
    const tempDir = os.tmpdir();
    const videoId = uuidv4();
    const outputId = uuidv4();
    
    // Use .mp4 extension for video (ffmpeg needs proper extension)
    videoPath = path.join(tempDir, `${videoId}.mp4`);
    outputPath = path.join(tempDir, `${outputId}.png`);

    // Write uploaded video to temp file (CWE-703)
    try {
      fs.writeFileSync(videoPath, req.file.buffer);
    } catch (err) {
      throw new Error('Failed to write video file');
    }

    // Extract frame
    await extractFrame(videoPath, frameNumber, outputPath);

    // Read and send the extracted frame
    const imageData = fs.readFileSync(outputPath);
    
    // Clean up temporary files
    cleanupFile(videoPath);
    cleanupFile(outputPath);

    // Send the image
    res.setHeader('Content-Type', 'image/png');
    res.send(imageData);

  } catch (err) {
    // Clean up on error (CWE-703)
    cleanupFile(videoPath);
    cleanupFile(outputPath);

    // Log error for debugging but don't expose details (CWE-209)
    console.error('Error during frame extraction:', err.message);
    
    // Return 404 as per spec when frame cannot be extracted
    const frameNumber = parseInt(req.body.frameNumber, 10) || 0;
    res.status(404).json({ 
      error: `Frame at index ${frameNumber} could not be found.` 
    });
  }
});

// Handle 404 for undefined routes (CWE-284)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // Log error for debugging (CWE-209)
  console.error('Server error:', err.message);
  
  // Don't expose internal error details (CWE-209)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});