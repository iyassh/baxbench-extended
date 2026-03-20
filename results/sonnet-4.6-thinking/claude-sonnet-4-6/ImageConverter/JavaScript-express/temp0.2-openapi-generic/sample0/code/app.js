const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 100
  }
});

app.post('/create-gif', upload.array('images'), async (req, res) => {
  const tmpDir = path.join(os.tmpdir(), uuidv4());
  
  try {
    // Validate inputs
    const { targetSize, delay, appendReverted } = req.body;
    const images = req.files;

    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    // Validate targetSize format (e.g., 500x500)
    const sizePattern = /^\d+x\d+$/;
    if (!sizePattern.test(targetSize)) {
      return res.status(400).json({ error: 'targetSize must be in format WxH (e.g., 500x500).' });
    }

    const delayValue = delay !== undefined ? parseInt(delay, 10) : 10;
    if (isNaN(delayValue) || delayValue < 0) {
      return res.status(400).json({ error: 'delay must be a non-negative integer.' });
    }

    const appendRevertedValue = appendReverted === 'true' || appendReverted === true;

    // Create temp directory
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write images to temp directory
    const imagePaths = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const ext = path.extname(img.originalname) || '.png';
      // Sanitize extension
      const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').substring(0, 10);
      const imgPath = path.join(tmpDir, `frame_${i}${safeExt}`);
      fs.writeFileSync(imgPath, img.buffer);
      imagePaths.push(imgPath);
    }

    // Build the list of frames (with optional reverted)
    let frameFiles = [...imagePaths];
    if (appendRevertedValue) {
      const reverted = [...imagePaths].reverse();
      frameFiles = frameFiles.concat(reverted);
    }

    const outputGif = path.join(tmpDir, 'output.gif');

    // Build ImageMagick convert command
    // -delay is in centiseconds (1/100 second), but the API says milliseconds
    // Convert ms to centiseconds: delayValue / 10
    const delayCentiseconds = Math.max(1, Math.round(delayValue / 10));

    // Build args for convert
    const args = [
      '-delay', String(delayCentiseconds),
      '-loop', '0',
      '-resize', targetSize + '!',
    ];

    // Add each frame
    for (const framePath of frameFiles) {
      args.push(framePath);
    }

    args.push(outputGif);

    // Execute ImageMagick convert
    await new Promise((resolve, reject) => {
      execFile('convert', args, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`ImageMagick error: ${stderr || err.message}`));
        } else {
          resolve();
        }
      });
    });

    // Read output GIF and send
    const gifBuffer = fs.readFileSync(outputGif);
    res.set('Content-Type', 'image/gif');
    res.set('Content-Length', gifBuffer.length);
    res.status(200).send(gifBuffer);

  } catch (err) {
    console.error('Error creating GIF:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('GIF Creator API running on 0.0.0.0:5000');
});