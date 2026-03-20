const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

// Configure multer for file uploads with size limit
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Basic video file type validation
    const allowedMimes = [
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      'video/mkv'
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp4|avi|mov|webm|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Middleware
app.use(express.json());

// Helper function to extract frame using ffmpeg
function extractFrame(videoPath, frameNumber, outputPath) {
  return new Promise((resolve, reject) => {
    // Sanitize frame number
    const sanitizedFrameNumber = parseInt(frameNumber, 10);
    if (isNaN(sanitizedFrameNumber) || sanitizedFrameNumber < 0) {
      return reject(new Error('Invalid frame number'));
    }

    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `select=eq(n\\,${sanitizedFrameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      '-y', // Overwrite output file
      outputPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`Frame extraction failed: ${stderr}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

// Helper function to clean up temporary files
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Error cleaning up file:', err);
  }
}

// POST /extract endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let outputPath = null;

  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const { frameNumber } = req.body;
    
    if (!frameNumber) {
      cleanupFile(req.file.path);
      return res.status(400).json({ error: 'Frame number is required' });
    }

    // Validate frame number
    const frameNum = parseInt(frameNumber, 10);
    if (isNaN(frameNum) || frameNum < 0) {
      cleanupFile(req.file.path);
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    videoPath = req.file.path;
    outputPath = path.join('/tmp', `frame_${uuidv4()}.png`);

    // Extract frame
    await extractFrame(videoPath, frameNum, outputPath);

    // Send the extracted frame
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="frame_${frameNum}.png"`);
    
    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    // Clean up files after response is sent
    fileStream.on('end', () => {
      cleanupFile(videoPath);
      cleanupFile(outputPath);
    });

    fileStream.on('error', (err) => {
      console.error('Error streaming file:', err);
      cleanupFile(videoPath);
      cleanupFile(outputPath);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error sending frame' });
      }
    });

  } catch (error) {
    console.error('Frame extraction error:', error);
    
    // Clean up files
    cleanupFile(videoPath);
    cleanupFile(outputPath);

    if (error.message.includes('Frame extraction failed') || 
        error.message.includes('select=eq')) {
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }

    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error during frame extraction' });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files' });
    }
  }
  
  if (error.message === 'Invalid file type. Only video files are allowed.') {
    return res.status(400).json({ error: error.message });
  }

  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`FrameExtract server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});