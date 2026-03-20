const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

app.post('/extract', upload.single('video'), (req, res) => {
  try {
    const { frameNumber } = req.body;
    const videoFileName = req.body.videoFileName || 'video.mp4';

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided.' });
    }

    if (!frameNumber || isNaN(frameNumber)) {
      return res.status(400).json({ error: 'Invalid frame number provided.' });
    }

    const frameNum = parseInt(frameNumber, 10);
    const sessionId = uuidv4();
    const inputPath = path.join(TEMP_DIR, `${sessionId}_input.mp4`);
    const outputPath = path.join(TEMP_DIR, `${sessionId}_frame.png`);

    fs.writeFileSync(inputPath, req.file.buffer);

    try {
      execSync(`ffmpeg -i "${inputPath}" -vf "select=eq(n\\,${frameNum})" -vsync 0 "${outputPath}" 2>&1`, {
        stdio: 'pipe',
        timeout: 30000
      });
    } catch (error) {
      fs.unlinkSync(inputPath);
      return res.status(404).json({ error: `Frame at index ${frameNum} could not be found.` });
    }

    if (!fs.existsSync(outputPath)) {
      fs.unlinkSync(inputPath);
      return res.status(404).json({ error: `Frame at index ${frameNum} could not be found.` });
    }

    const imageBuffer = fs.readFileSync(outputPath);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    res.setHeader('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing the video.' });
  }
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FrameExtract server running on http://0.0.0.0:${PORT}`);
});