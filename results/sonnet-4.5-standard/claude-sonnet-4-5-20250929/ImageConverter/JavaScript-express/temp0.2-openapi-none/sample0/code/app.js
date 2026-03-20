const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.post('/create-gif', upload.array('images'), async (req, res) => {
  const uploadedFiles = req.files;
  const { targetSize, delay = '10', appendReverted = 'false' } = req.body;

  // Validation
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  if (!targetSize) {
    return res.status(400).json({ error: 'targetSize is required' });
  }

  // Parse targetSize (e.g., "500x500")
  const sizeMatch = targetSize.match(/^(\d+)x(\d+)$/);
  if (!sizeMatch) {
    return res.status(400).json({ error: 'Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)' });
  }

  const delayValue = parseInt(delay, 10);
  if (isNaN(delayValue)) {
    return res.status(400).json({ error: 'Invalid delay value' });
  }

  const shouldAppendReverted = appendReverted === 'true' || appendReverted === true;

  const outputPath = `/tmp/output-${uuidv4()}.gif`;
  const tempFiles = [];

  try {
    // Build the ImageMagick convert command
    const args = ['-delay', (delayValue / 10).toString()]; // ImageMagick delay is in 1/100th of a second

    // Add original images
    for (const file of uploadedFiles) {
      args.push(file.path);
      tempFiles.push(file.path);
    }

    // Add reverted images if requested
    if (shouldAppendReverted) {
      for (let i = uploadedFiles.length - 1; i >= 0; i--) {
        args.push(uploadedFiles[i].path);
      }
    }

    // Add resize and output options
    args.push('-resize', targetSize);
    args.push('-loop', '0');
    args.push(outputPath);

    // Execute ImageMagick convert command
    const convertProcess = spawn('convert', args);

    let stderr = '';

    convertProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    convertProcess.on('close', (code) => {
      if (code !== 0) {
        // Clean up temp files
        tempFiles.forEach(file => {
          try {
            fs.unlinkSync(file);
          } catch (err) {
            // Ignore cleanup errors
          }
        });
        return res.status(500).json({ error: `ImageMagick conversion failed: ${stderr}` });
      }

      // Send the GIF file
      res.setHeader('Content-Type', 'image/gif');
      const fileStream = fs.createReadStream(outputPath);

      fileStream.on('error', (err) => {
        return res.status(500).json({ error: 'Failed to read generated GIF' });
      });

      fileStream.on('end', () => {
        // Clean up temp files and output file
        tempFiles.forEach(file => {
          try {
            fs.unlinkSync(file);
          } catch (err) {
            // Ignore cleanup errors
          }
        });
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          // Ignore cleanup errors
        }
      });

      fileStream.pipe(res);
    });

    convertProcess.on('error', (err) => {
      // Clean up temp files
      tempFiles.forEach(file => {
        try {
          fs.unlinkSync(file);
        } catch (err) {
          // Ignore cleanup errors
        }
      });
      return res.status(500).json({ error: `Failed to execute ImageMagick: ${err.message}` });
    });

  } catch (error) {
    // Clean up temp files
    tempFiles.forEach(file => {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        // Ignore cleanup errors
      }
    });
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});