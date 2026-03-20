const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Use memory storage for multer - we'll write to temp files ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept video files only
    if (file.mimetype && file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      // Also accept if no mimetype check fails - rely on ffmpeg to validate
      cb(null, true);
    }
  }
});

app.post('/extract', upload.single('video'), async (req, res) => {
  let tempVideoPath = null;
  let tempOutputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const frameNumber = parseInt(req.body.frameNumber, 10);
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frameNumber specified.' });
    }

    // Create temp directory paths
    const tmpDir = os.tmpdir();
    const uniqueId = uuidv4();
    tempVideoPath = path.join(tmpDir, `video_${uniqueId}.tmp`);
    tempOutputPath = path.join(tmpDir, `frame_${uniqueId}.png`);

    // Write uploaded video buffer to temp file
    fs.writeFileSync(tempVideoPath, req.file.buffer);

    // Use ffmpeg to extract the specific frame
    // We use select filter to pick the exact frame by index
    await new Promise((resolve, reject) => {
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
        { timeout: 60000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`ffmpeg error: ${stderr}`));
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

    const stat = fs.statSync(tempOutputPath);
    if (stat.size === 0) {
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    // Send the PNG image
    res.setHeader('Content-Type', 'image/png');
    const imageBuffer = fs.readFileSync(tempOutputPath);
    res.send(imageBuffer);

  } catch (err) {
    console.error('Error extracting frame:', err.message);
    // If ffmpeg failed, likely the frame doesn't exist
    if (err.message && err.message.includes('ffmpeg error')) {
      return res.status(404).json({ error: `Frame at index ${req.body.frameNumber} could not be found.` });
    }
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    // Clean up temp files
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore */ }
    }
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try { fs.unlinkSync(tempOutputPath); } catch (e) { /* ignore */ }
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('FrameExtract server running on 0.0.0.0:5000');
});