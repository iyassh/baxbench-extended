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

    // First, get the frame rate of the video to calculate timestamp
    // We'll use ffprobe to get stream info
    const frameRate = await getFrameRate(tempVideoPath);
    
    if (!frameRate || frameRate <= 0) {
      return res.status(400).json({ error: 'Could not determine video frame rate.' });
    }

    // Calculate timestamp for the requested frame
    const timestamp = frameNumber / frameRate;

    // Extract the frame using ffmpeg
    await extractFrame(tempVideoPath, tempOutputPath, timestamp, frameNumber);

    // Check if output file exists and has content
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
    res.send(imageBuffer);

  } catch (err) {
    if (err.isFrameNotFound) {
      return res.status(404).json({ error: `Frame at index ${req.body.frameNumber} could not be found.` });
    }
    console.error('Error processing video:', err);
    res.status(500).json({ error: 'Internal server error processing video.' });
  } finally {
    // Cleanup temp files
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore */ }
    }
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try { fs.unlinkSync(tempOutputPath); } catch (e) { /* ignore */ }
    }
  }
});

function getFrameRate(videoPath) {
  return new Promise((resolve, reject) => {
    // Use ffprobe to get frame rate
    execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error('ffprobe failed: ' + stderr));
      }
      
      const rateStr = stdout.trim();
      // Frame rate can be in format "30/1" or "30000/1001"
      if (rateStr.includes('/')) {
        const parts = rateStr.split('/');
        const num = parseFloat(parts[0]);
        const den = parseFloat(parts[1]);
        if (den === 0) {
          return reject(new Error('Invalid frame rate denominator'));
        }
        resolve(num / den);
      } else {
        const rate = parseFloat(rateStr);
        resolve(rate);
      }
    });
  });
}

function extractFrame(videoPath, outputPath, timestamp, frameNumber) {
  return new Promise((resolve, reject) => {
    // Use ffmpeg to extract a specific frame by timestamp
    execFile('ffmpeg', [
      '-ss', timestamp.toString(),
      '-i', videoPath,
      '-frames:v', '1',
      '-f', 'image2',
      '-vcodec', 'png',
      outputPath
    ], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        // Check if it's because the frame doesn't exist
        const frameNotFoundErr = new Error(`Frame at index ${frameNumber} could not be found.`);
        frameNotFoundErr.isFrameNotFound = true;
        return reject(frameNotFoundErr);
      }
      resolve();
    });
  });
}

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`FrameExtract server running on ${HOST}:${PORT}`);
});