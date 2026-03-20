<CODE>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Configure multer for file uploads with security constraints
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only allow video files
    const allowedMimeTypes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Cleanup function to remove temporary files
function cleanupFiles(files) {
  files.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error(`Error deleting file ${file}:`, err);
      }
    }
  });
}

app.post('/extract', upload.single('video'), async (req, res) => {
  const tempFiles = [];
  
  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const frameNumber = parseInt(req.body.frameNumber);
    
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number. Must be a non-negative integer.' });
    }

    // Generate unique filenames to avoid conflicts
    const uniqueId = uuidv4();
    const videoPath = path.join(TEMP_DIR, `video_${uniqueId}.tmp`);
    const outputPath = path.join(TEMP_DIR, `frame_${uniqueId}.png`);
    
    tempFiles.push(videoPath, outputPath);

    // Write uploaded video to temporary file
    fs.writeFileSync(videoPath, req.file.buffer);

    // Use ffmpeg to extract the specific frame
    // -i: input file
    // -vf "select=eq(n\,{frameNumber})": select the frame at the specified index
    // -vframes 1: output only one frame
    // -f image2: force image format
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 -f image2 "${outputPath}" 2>&1`;

    exec(ffmpegCommand, { timeout: 30000 }, (error, stdout, stderr) => {
      // Check if output file was created
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        // Read the extracted frame
        const imageBuffer = fs.readFileSync(outputPath);
        
        // Send the image
        res.setHeader('Content-Type', 'image/png');
        res.send(imageBuffer);
        
        // Cleanup temporary files
        cleanupFiles(tempFiles);
      } else {
        // Frame not found or extraction failed
        cleanupFiles(tempFiles);
        res.status(404).json({ 
          error: `Frame at index ${frameNumber} could not be found.` 
        });
      }
    });

  } catch (err) {
    console.error('Error processing request:', err);
    cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Internal server error while processing video' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum 500MB allowed.' });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
</CODE>