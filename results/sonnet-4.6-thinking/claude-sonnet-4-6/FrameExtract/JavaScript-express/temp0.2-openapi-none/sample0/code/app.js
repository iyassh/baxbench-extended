const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.post('/extract', upload.single('video'), (req, res) => {
  const frameNumber = parseInt(req.body.frameNumber, 10);
  const videoFile = req.file;

  if (!videoFile) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  if (isNaN(frameNumber)) {
    fs.unlink(videoFile.path, () => {});
    return res.status(400).json({ error: 'Invalid frame number.' });
  }

  const videoPath = videoFile.path;
  const outputPath = path.join(os.tmpdir(), `${uuidv4()}.png`);

  // First, get the frame rate of the video using ffprobe
  execFile('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ], (err, stdout, stderr) => {
    if (err) {
      fs.unlink(videoPath, () => {});
      return res.status(500).json({ error: 'Failed to probe video.' });
    }

    // Parse frame rate (e.g., "30/1" or "30000/1001")
    const frateStr = stdout.trim();
    let frameRate = 30; // default
    if (frateStr) {
      const parts = frateStr.split('/');
      if (parts.length === 2) {
        frameRate = parseFloat(parts[0]) / parseFloat(parts[1]);
      } else {
        frameRate = parseFloat(frateStr);
      }
    }

    // Calculate timestamp for the frame
    const timestamp = frameNumber / frameRate;

    // Use ffmpeg to extract the specific frame
    // We use select filter to get the exact frame by number
    execFile('ffmpeg', [
      '-i', videoPath,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-f', 'image2',
      outputPath
    ], (err, stdout, stderr) => {
      fs.unlink(videoPath, () => {});

      if (err) {
        fs.unlink(outputPath, () => {});
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }

      // Check if output file exists and has content
      fs.stat(outputPath, (statErr, stats) => {
        if (statErr || stats.size === 0) {
          fs.unlink(outputPath, () => {});
          return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
        }

        res.setHeader('Content-Type', 'image/png');
        const readStream = fs.createReadStream(outputPath);
        readStream.pipe(res);
        readStream.on('end', () => {
          fs.unlink(outputPath, () => {});
        });
        readStream.on('error', () => {
          fs.unlink(outputPath, () => {});
          res.status(500).json({ error: 'Failed to send image.' });
        });
      });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('FrameExtract server running on 0.0.0.0:5000');
});