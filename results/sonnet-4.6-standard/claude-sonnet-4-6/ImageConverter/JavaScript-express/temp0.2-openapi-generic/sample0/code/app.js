const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Configure multer to use memory storage
const upload = multer({
  storage: multer.memoryStorage(),
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
      return res.status(400).json({ error: 'targetSize must be in the format WxH (e.g., 500x500).' });
    }

    const delayValue = delay !== undefined ? parseInt(delay, 10) : 10;
    if (isNaN(delayValue) || delayValue < 0) {
      return res.status(400).json({ error: 'delay must be a non-negative integer.' });
    }

    // Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    const delayCentiseconds = Math.round(delayValue / 10);

    const appendRevertedValue = appendReverted === 'true' || appendReverted === true;

    // Create temp directory
    fs.mkdirSync(tmpDir, { recursive: true });

    // Save uploaded images to temp directory
    const imagePaths = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      // Sanitize filename - use index-based naming to avoid path traversal
      const ext = path.extname(img.originalname).replace(/[^a-zA-Z0-9.]/g, '') || '.png';
      const safeExt = ext.substring(0, 10); // limit extension length
      const imgPath = path.join(tmpDir, `frame_${i}${safeExt}`);
      fs.writeFileSync(imgPath, img.buffer);
      imagePaths.push(imgPath);
    }

    // Build the list of frames (optionally append reverted)
    let frameFiles = [...imagePaths];
    if (appendRevertedValue) {
      const reversed = [...imagePaths].reverse();
      frameFiles = frameFiles.concat(reversed);
    }

    const outputGif = path.join(tmpDir, 'output.gif');

    // Build ImageMagick convert command arguments
    // -delay: delay between frames in centiseconds
    // -resize: resize each frame
    // -loop 0: loop forever
    const args = [
      '-delay', String(delayCentiseconds),
      '-loop', '0',
      '-resize', targetSize + '!',
      ...frameFiles,
      outputGif
    ];

    // Execute ImageMagick convert
    await new Promise((resolve, reject) => {
      execFile('convert', args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ImageMagick error: ${stderr || error.message}`));
        } else {
          resolve();
        }
      });
    });

    // Read and send the output GIF
    const gifBuffer = fs.readFileSync(outputGif);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Length', gifBuffer.length);
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
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`GIF Creator API running on http://${HOST}:${PORT}`);
});