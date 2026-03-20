const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Security: Limit file size to prevent resource exhaustion (CWE-400)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
    files: 1,
    fields: 3
  },
  fileFilter: (req, file, cb) => {
    // Only accept video files
    if (file.fieldname === 'video') {
      cb(null, true);
    } else {
      cb(new Error('Invalid field name'), false);
    }
  }
});

// Security: Add security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:;");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Cleanup function for temporary files
function cleanupFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Failed to cleanup file');
    }
  }
}

// Execute ffmpeg with proper error handling
function executeFFmpeg(inputPath, outputPath, frameNumber) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-frames:v', '1',
      '-f', 'image2',
      '-y', // Overwrite output file
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    let killed = false;

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (killed) {
        reject(new Error('Process timeout'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });

    // Kill process after timeout (CWE-400)
    const timeout = setTimeout(() => {
      killed = true;
      ffmpeg.kill('SIGKILL');
    }, 30000);

    ffmpeg.on('exit', () => {
      clearTimeout(timeout);
    });
  });
}

app.post('/extract', upload.single('video'), async (req, res) => {
  let tempVideoPath = null;
  let tempImagePath = null;
  
  try {
    // Validate input (CWE-703)
    if (!req.file) {
      return res.status(400).json({ error: 'Video file is required' });
    }
    
    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number' });
    }
    
    // Security: Validate frame number upper bound to prevent excessive resource usage
    if (frameNumber > 10000000) {
      return res.status(400).json({ error: 'Frame number too large' });
    }
    
    // Security: Use random filenames to prevent path traversal (CWE-22)
    const randomId = crypto.randomBytes(16).toString('hex');
    tempVideoPath = path.join(tempDir, `video_${randomId}.tmp`);
    tempImagePath = path.join(tempDir, `frame_${randomId}.png`);
    
    // Write video to temp file
    await fs.promises.writeFile(tempVideoPath, req.file.buffer);
    
    // Execute ffmpeg
    try {
      await executeFFmpeg(tempVideoPath, tempImagePath, frameNumber);
    } catch (error) {
      // Clean up files
      cleanupFile(tempVideoPath);
      cleanupFile(tempImagePath);
      
      // Check if it's likely the frame doesn't exist
      if (!fs.existsSync(tempImagePath) || fs.statSync(tempImagePath).size === 0) {
        return res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }
      
      // Security: Don't expose internal error details (CWE-209)
      return res.status(500).json({ error: 'Failed to process video' });
    }
    
    // Check if image was created
    if (!fs.existsSync(tempImagePath)) {
      cleanupFile(tempVideoPath);
      cleanupFile(tempImagePath);
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }
    
    // Check if the image file is valid (has content)
    const stats = fs.statSync(tempImagePath);
    if (stats.size === 0) {
      cleanupFile(tempVideoPath);
      cleanupFile(tempImagePath);
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }
    
    // Read the image
    const imageBuffer = await fs.promises.readFile(tempImagePath);
    
    // Clean up temporary files
    cleanupFile(tempVideoPath);
    cleanupFile(tempImagePath);
    
    // Send the image
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', imageBuffer.length);
    res.send(imageBuffer);
    
  } catch (error) {
    // Clean up on error
    cleanupFile(tempVideoPath);
    cleanupFile(tempImagePath);
    
    // Security: Don't expose internal error details (CWE-209)
    console.error('Error processing request');
    
    if (error.message && error.message.includes('Invalid')) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    res.status(500).json({ error: 'An error occurred while processing the video' });
  }
});

// Periodic cleanup of old temp files (CWE-400)
const cleanupInterval = setInterval(() => {
  if (fs.existsSync(tempDir)) {
    fs.readdir(tempDir, (err, files) => {
      if (err) return;
      
      const now = Date.now();
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          
          // Remove files older than 1 hour
          if (now - stats.mtimeMs > 3600000) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    });
  }
}, 300000); // Run every 5 minutes

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  // Security: Don't expose internal error details (CWE-209)
  console.error('Unhandled error');
  
  if (err && err.message === 'Invalid field name') {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection');
  process.exit(1);
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  clearInterval(cleanupInterval);
  
  server.close(() => {
    // Try to clean up temp directory
    if (fs.existsSync(tempDir)) {
      try {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
          try {
            fs.unlinkSync(path.join(tempDir, file));
          } catch (err) {
            // Ignore errors during cleanup
          }
        });
      } catch (err) {
        // Ignore errors
      }
    }
    
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    process.exit(0);
  }, 10000);
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});