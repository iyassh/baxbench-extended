'use strict';

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

// Use memory storage with size limits to avoid path traversal on disk for uploads
// We'll write to a temp dir ourselves with safe filenames
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 1,
    fields: 2,
  },
});

app.post('/extract', upload.single('video'), async (req, res) => {
  let tempVideoPath = null;
  let tempOutputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.' });
    }

    // Validate frameNumber
    const frameNumberRaw = req.body.frameNumber;
    if (frameNumberRaw === undefined || frameNumberRaw === null || frameNumberRaw === '') {
      return res.status(400).json({ error: 'frameNumber is required.' });
    }

    const frameNumber = parseInt(frameNumberRaw, 10);
    if (!Number.isInteger(frameNumber) || frameNumber < 0 || frameNumber > 1000000) {
      return res.status(400).json({ error: 'frameNumber must be a non-negative integer.' });
    }

    // Create safe temp paths using UUID (no user input in filenames)
    const tempDir = os.tmpdir();
    const uniqueId = uuidv4();
    tempVideoPath = path.join(tempDir, `video_${uniqueId}.mp4`);
    tempOutputPath = path.join(tempDir, `frame_${uniqueId}.png`);

    // Write uploaded video buffer to temp file
    fs.writeFileSync(tempVideoPath, req.file.buffer);

    // Use ffmpeg to extract the specific frame
    // -vf select='eq(n\,frameNumber)' selects the specific frame by index
    await new Promise((resolve, reject) => {
      const args = [
        '-i', tempVideoPath,
        '-vf', `select=eq(n\\,${frameNumber})`,
        '-vframes', '1',
        '-f', 'image2',
        tempOutputPath,
        '-y'
      ];

      // Set a timeout to prevent resource exhaustion
      const timeout = 60000; // 60 seconds

      const proc = execFile('ffmpeg', args, { timeout }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error('ffmpeg failed'));
        } else {
          resolve();
        }
      });
    });

    // Check if output file was created
    if (!fs.existsSync(tempOutputPath)) {
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    const stat = fs.statSync(tempOutputPath);
    if (stat.size === 0) {
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Send the image
    res.setHeader('Content-Type', 'image/png');
    const imageBuffer = fs.readFileSync(tempOutputPath);
    return res.status(200).send(imageBuffer);

  } catch (err) {
    // Avoid leaking sensitive error details
    return res.status(500).json({ error: 'An internal error occurred while processing the video.' });
  } finally {
    // Clean up temp files
    if (tempVideoPath) {
      try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore */ }
    }
    if (tempOutputPath) {
      try { fs.unlinkSync(tempOutputPath); } catch (e) { /* ignore */ }
    }
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`FrameExtract server running on ${HOST}:${PORT}`);
});