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
    const { targetSize, delay, appendReverted } = req.body;

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

    const delayValue = delay ? parseInt(delay, 10) : 10;
    if (isNaN(delayValue)) {
      return res.status(400).json({ error: 'delay must be an integer.' });
    }

    // Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    const delayCentiseconds = Math.round(delayValue / 10);

    const appendRevertedBool = appendReverted === 'true' || appendReverted === true;

    const tmpDir = path.join(os.tmpdir(), uuidv4());
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write uploaded images to temp directory
    const imagePaths = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file.originalname) || '.png';
      const filePath = path.join(tmpDir, `frame_${i}${ext}`);
      fs.writeFileSync(filePath, file.buffer);
      imagePaths.push(filePath);
    }

    // Build the list of frames
    let frames = [...imagePaths];
    if (appendRevertedBool) {
      const reverted = [...imagePaths].reverse();
      frames = frames.concat(reverted);
    }

    const outputGif = path.join(tmpDir, 'output.gif');

    // Build ImageMagick convert command
    // convert -delay <delay> -resize <size> frame1 frame2 ... output.gif
    const args = [
      '-delay', String(delayCentiseconds),
      '-resize', targetSize,
      ...frames,
      outputGif
    ];

    execFile('convert', args, (err, stdout, stderr) => {
      if (err) {
        // Cleanup
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
        console.error('ImageMagick error:', stderr);
        return res.status(500).json({ error: 'Failed to create GIF: ' + stderr });
      }

      // Read output GIF and send
      fs.readFile(outputGif, (readErr, data) => {
        // Cleanup
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

        if (readErr) {
          return res.status(500).json({ error: 'Failed to read output GIF.' });
        }

        res.setHeader('Content-Type', 'image/gif');
        res.send(data);
      });
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('GIF Creator API running on http://0.0.0.0:5000');
});