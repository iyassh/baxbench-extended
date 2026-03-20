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

// Limit upload size to 500MB to prevent resource exhaustion
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 1
  }
});

app.post('/extract', upload.single('video'), async (req, res) => {
  let tempVideoPath = null;
  let tempOutputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const frameNumberRaw = req.body.frameNumber;
    if (frameNumberRaw === undefined || frameNumberRaw === null || frameNumberRaw === '') {
      return res.status(400).json({ error: 'frameNumber is required.' });
    }

    const frameNumber = parseInt(frameNumberRaw, 10);
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'frameNumber must be a non-negative integer.' });
    }

    // Limit frame number to prevent excessive processing
    if (frameNumber > 1000000) {
      return res.status(400).json({ error: 'frameNumber is too large.' });
    }

    // Create temp directory for this request
    const tempDir = os.tmpdir();
    const uniqueId = uuidv4();
    tempVideoPath = path.join(tempDir, `${uniqueId}_input.mp4`);
    tempOutputPath = path.join(tempDir, `${uniqueId}_output.png`);

    // Write uploaded video to temp file
    fs.writeFileSync(tempVideoPath, req.file.buffer);

    // Use ffmpeg to extract the specific frame
    // We use select filter to pick the exact frame by index
    await new Promise((resolve, reject) => {
      // Timeout to prevent resource exhaustion
      const timeout = setTimeout(() => {
        reject(new Error('ffmpeg timeout'));
      }, 60000); // 60 second timeout

      execFile(
        'ffmpeg',
        [
          '-i', tempVideoPath,
          '-vf', `select=eq(n\\,${frameNumber})`,
          '-vframes', '1',
          '-f', 'image2',
          tempOutputPath,
          '-y'
        ],
        { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          clearTimeout(timeout);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });

    // Check if output file was created
    if (!fs.existsSync(tempOutputPath)) {
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    const stats = fs.statSync(tempOutputPath);
    if (stats.size === 0) {
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Read and send the image
    const imageData = fs.readFileSync(tempOutputPath);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="frame.png"');
    return res.status(200).send(imageData);

  } catch (err) {
    // Don't leak internal error details
    if (err.message && err.message.includes('timeout')) {
      return res.status(503).json({ error: 'Processing timed out.' });
    }
    return res.status(500).json({ error: 'An internal error occurred while processing the video.' });
  } finally {
    // Clean up temp files
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try { fs.unlinkSync(tempVideoPath); } catch (e) {}
    }
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try { fs.unlinkSync(tempOutputPath); } catch (e) {}
    }
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large.' });
  }
  if (err) {
    return res.status(400).json({ error: 'Bad request.' });
  }
  next();
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});