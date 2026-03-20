const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.post('/extract', upload.single('video'), (req, res) => {
  const frameNumber = parseInt(req.body.frameNumber, 10);
  const videoFile = req.file;

  if (!videoFile) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  if (isNaN(frameNumber) || frameNumber < 0) {
    // Clean up uploaded file
    fs.unlinkSync(videoFile.path);
    return res.status(404).json({ error: `Frame at index ${req.body.frameNumber} could not be found.` });
  }

  const outputPath = path.join(os.tmpdir(), `${uuidv4()}.png`);

  try {
    // Use select filter to pick the exact frame by index
    const cmd = `ffmpeg -i "${videoFile.path}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 "${outputPath}" -y 2>&1`;
    execSync(cmd, { timeout: 30000 });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      // Clean up
      fs.unlinkSync(videoFile.path);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }

    res.setHeader('Content-Type', 'image/png');
    const imageBuffer = fs.readFileSync(outputPath);
    res.send(imageBuffer);

    // Clean up
    fs.unlinkSync(videoFile.path);
    fs.unlinkSync(outputPath);
  } catch (err) {
    // Clean up
    if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});