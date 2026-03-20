const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/create-gif', upload.array('images'), async (req, res) => {
  try {
    const files = req.files;
    const targetSize = req.body.targetSize;
    const delay = parseInt(req.body.delay) || 10;
    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    const sizeMatch = targetSize.match(/^(\d+)x(\d+)$/);
    if (!sizeMatch) {
      return res.status(400).json({ error: 'targetSize must be in format WxH, e.g. 500x500.' });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-'));
    const sessionId = uuidv4();

    try {
      // Write uploaded images to temp directory
      const imagePaths = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = path.extname(file.originalname) || '.png';
        const imgPath = path.join(tmpDir, `frame_${i}${ext}`);
        fs.writeFileSync(imgPath, file.buffer);
        imagePaths.push(imgPath);
      }

      const outputGif = path.join(tmpDir, `output_${sessionId}.gif`);

      // Build convert command arguments
      // convert -delay <delay/10> -loop 0 -resize WxH img1 img2 ... output.gif
      // Note: ImageMagick delay is in centiseconds (1/100 sec), input is ms
      // delay in ms -> centiseconds = delay / 10
      const delayCentiseconds = Math.round(delay / 10);

      const args = ['-delay', String(delayCentiseconds), '-loop', '0', '-resize', targetSize];

      // Add forward frames
      for (const imgPath of imagePaths) {
        args.push(imgPath);
      }

      // If appendReverted, add reversed frames
      if (appendReverted) {
        const reversedPaths = [...imagePaths].reverse();
        for (const imgPath of reversedPaths) {
          args.push(imgPath);
        }
      }

      args.push(outputGif);

      await new Promise((resolve, reject) => {
        execFile('convert', args, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve();
          }
        });
      });

      const gifBuffer = fs.readFileSync(outputGif);
      res.setHeader('Content-Type', 'image/gif');
      res.send(gifBuffer);

    } finally {
      // Cleanup temp directory
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        // ignore cleanup errors
      }
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('GIF Creator API running on http://0.0.0.0:5000');
});