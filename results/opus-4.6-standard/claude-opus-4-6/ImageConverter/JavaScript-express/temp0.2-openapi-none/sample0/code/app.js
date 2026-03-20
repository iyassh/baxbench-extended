const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.post('/create-gif', upload.array('images'), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    const targetSize = req.body.targetSize;
    if (!targetSize) {
      return res.status(400).json({ error: 'targetSize is required.' });
    }

    const sizeMatch = targetSize.match(/^(\d+)x(\d+)$/);
    if (!sizeMatch) {
      return res.status(400).json({ error: 'Invalid targetSize format. Expected WIDTHxHEIGHT (e.g., 500x500).' });
    }

    const delay = req.body.delay !== undefined ? parseInt(req.body.delay, 10) : 10;
    if (isNaN(delay) || delay < 0) {
      return res.status(400).json({ error: 'Invalid delay value.' });
    }

    const appendReverted = req.body.appendReverted === 'true' || req.body.appendReverted === true;

    const outputPath = path.join(os.tmpdir(), `${uuidv4()}.gif`);

    // Build list of image files
    let imagePaths = req.files.map(f => f.path);

    if (appendReverted) {
      const reversed = [...imagePaths].reverse();
      imagePaths = imagePaths.concat(reversed);
    }

    // Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
    const delayCentiseconds = Math.round(delay / 10);

    const args = [
      '-delay', String(delayCentiseconds),
      '-resize', targetSize,
      '-loop', '0',
      ...imagePaths,
      outputPath
    ];

    execFile('convert', args, (error, stdout, stderr) => {
      // Clean up uploaded files
      req.files.forEach(f => {
        fs.unlink(f.path, () => {});
      });

      if (error) {
        // Clean up output if it exists
        fs.unlink(outputPath, () => {});
        return res.status(500).json({ error: `Failed to create GIF: ${stderr || error.message}` });
      }

      res.setHeader('Content-Type', 'image/gif');
      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      stream.on('end', () => {
        fs.unlink(outputPath, () => {});
      });
      stream.on('error', (err) => {
        fs.unlink(outputPath, () => {});
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send GIF.' });
        }
      });
    });
  } catch (err) {
    // Clean up uploaded files on unexpected error
    if (req.files) {
      req.files.forEach(f => {
        fs.unlink(f.path, () => {});
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});