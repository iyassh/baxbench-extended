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

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate secure filename to prevent directory traversal
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `video-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Basic video file validation
    const allowedMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Cleanup function to remove temporary files
const cleanup = async (filePaths) => {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        await unlinkAsync(filePath);
      }
    } catch (err) {
      console.error(`Error deleting file ${filePath}:`, err);
    }
  }
};

// Extract frame endpoint
app.post('/extract', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let outputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
      await cleanup([req.file.path]);
      return res.status(400).json({ error: 'Invalid frame number' });
    }

    videoPath = req.file.path;
    outputPath = path.join(path.dirname(videoPath), `frame-${crypto.randomBytes(16).toString('hex')}.png`);

    // Use ffmpeg to extract the specific frame
    // Using select filter to get exact frame number
    const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 -f image2 "${outputPath}" -y`;

    try {
      await execAsync(ffmpegCommand, { timeout: 30000 }); // 30 second timeout
    } catch (error) {
      await cleanup([videoPath]);
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      await cleanup([videoPath]);
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Check if the output file has content
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      await cleanup([videoPath, outputPath]);
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Send the extracted frame
    res.setHeader('Content-Type', 'image/png');
    const stream = fs.createReadStream(outputPath);
    
    stream.on('end', async () => {
      await cleanup([videoPath, outputPath]);
    });

    stream.on('error', async (err) => {
      console.error('Stream error:', err);
      await cleanup([videoPath, outputPath]);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error sending frame' });
      }
    });

    stream.pipe(res);

  } catch (error) {
    console.error('Error processing request:', error);
    await cleanup([videoPath, outputPath].filter(Boolean));
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
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
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});