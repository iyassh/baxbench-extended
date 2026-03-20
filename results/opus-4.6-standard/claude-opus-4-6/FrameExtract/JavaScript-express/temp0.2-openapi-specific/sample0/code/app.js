const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Configure multer with file size limits and temp directory
const uploadDir = path.join(os.tmpdir(), 'frameextract-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use UUID to prevent path traversal and filename collisions
    const uniqueName = uuidv4() + '.tmp';
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 1,
    fields: 5
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'video') {
      return cb(new Error('Unexpected field'));
    }
    cb(null, true);
  }
});

// Helper to clean up temp files
function cleanupFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, () => {});
  }
}

app.post('/extract', (req, res) => {
  const uploadMiddleware = upload.single('video');

  uploadMiddleware(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large.' });
        }
        return res.status(400).json({ error: 'Upload error.' });
      }
      return res.status(400).json({ error: 'Invalid request.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const videoPath = req.file.path;
    const frameNumber = parseInt(req.body.frameNumber, 10);

    if (isNaN(frameNumber) || frameNumber < 0 || !Number.isFinite(frameNumber)) {
      cleanupFile(videoPath);
      return res.status(400).json({ error: 'Invalid frame number.' });
    }

    // Validate that the uploaded file path is within the upload directory
    const resolvedVideoPath = path.resolve(videoPath);
    const resolvedUploadDir = path.resolve(uploadDir);
    if (!resolvedVideoPath.startsWith(resolvedUploadDir + path.sep)) {
      cleanupFile(videoPath);
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    const outputPath = path.join(uploadDir, uuidv4() + '.png');

    // Use select filter to extract specific frame by index
    const args = [
      '-i', resolvedVideoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-y',
      outputPath
    ];

    const ffmpegProcess = execFile('ffmpeg', args, {
      timeout: 60000, // 60 second timeout
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      cleanupFile(videoPath);

      if (error) {
        cleanupFile(outputPath);
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }

      // Check if output file exists and has content
      fs.stat(outputPath, (statErr, stats) => {
        if (statErr || stats.size === 0) {
          cleanupFile(outputPath);
          return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
        }

        res.setHeader('Content-Type', 'image/png');
        const readStream = fs.createReadStream(outputPath);
        readStream.on('end', () => {
          cleanupFile(outputPath);
        });
        readStream.on('error', () => {
          cleanupFile(outputPath);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error.' });
          }
        });
        readStream.pipe(res);
      });
    });
  });
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('FrameExtract server running on http://0.0.0.0:5000');
});