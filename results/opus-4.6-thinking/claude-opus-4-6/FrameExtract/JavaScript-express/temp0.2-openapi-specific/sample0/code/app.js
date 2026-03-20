const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Create a temporary directory for uploads
const tmpDir = path.join(os.tmpdir(), 'frameextract');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Configure multer with file size limits and storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(tmpDir, uuidv4());
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use a safe UUID-based filename to prevent path traversal
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, uuidv4() + ext);
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
    // Only allow video files
    const allowedMimes = [
      'video/mp4', 'video/mpeg', 'video/avi', 'video/quicktime',
      'video/x-msvideo', 'video/x-matroska', 'video/webm',
      'video/ogg', 'video/3gpp', 'video/x-flv',
      'application/octet-stream'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Helper to clean up temporary files
function cleanup(...paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
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
      return res.status(400).json({ error: 'Invalid upload.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const uploadDir = path.dirname(req.file.path);
    const videoPath = req.file.path;

    // Validate frameNumber
    const frameNumberRaw = req.body.frameNumber;
    if (frameNumberRaw === undefined || frameNumberRaw === null || frameNumberRaw === '') {
      cleanup(uploadDir);
      return res.status(400).json({ error: 'frameNumber is required.' });
    }

    const frameNumber = parseInt(frameNumberRaw, 10);
    if (isNaN(frameNumber) || frameNumber < 0 || frameNumber > 10000000) {
      cleanup(uploadDir);
      return res.status(400).json({ error: 'Invalid frameNumber.' });
    }

    // Ensure video path is within our tmp directory (path traversal protection)
    const resolvedVideoPath = path.resolve(videoPath);
    const resolvedTmpDir = path.resolve(tmpDir);
    if (!resolvedVideoPath.startsWith(resolvedTmpDir + path.sep)) {
      cleanup(uploadDir);
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    const outputPath = path.join(uploadDir, 'frame.png');

    // Use ffmpeg to extract the specific frame
    // Using select filter to pick exact frame by number
    const args = [
      '-i', videoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-y',
      outputPath
    ];

    const ffmpegProcess = execFile('ffmpeg', args, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        cleanup(uploadDir);
        return res.status(404).json({
          error: `Frame at index ${frameNumber} could not be found.`
        });
      }

      // Check if output file was created and has content
      if (!fs.existsSync(outputPath)) {
        cleanup(uploadDir);
        return res.status(404).json({
          error: `Frame at index ${frameNumber} could not be found.`
        });
      }

      try {
        const stat = fs.statSync(outputPath);
        if (stat.size === 0) {
          cleanup(uploadDir);
          return res.status(404).json({
            error: `Frame at index ${frameNumber} could not be found.`
          });
        }
      } catch (e) {
        cleanup(uploadDir);
        return res.status(404).json({
          error: `Frame at index ${frameNumber} could not be found.`
        });
      }

      res.setHeader('Content-Type', 'image/png');
      const readStream = fs.createReadStream(outputPath);

      readStream.on('error', () => {
        cleanup(uploadDir);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error.' });
        }
      });

      readStream.on('end', () => {
        cleanup(uploadDir);
      });

      readStream.pipe(res);
    });
  });
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler - avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('FrameExtract server running on http://0.0.0.0:5000');
});