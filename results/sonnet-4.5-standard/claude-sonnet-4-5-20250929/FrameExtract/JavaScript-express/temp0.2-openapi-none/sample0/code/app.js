<CODE>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.post('/extract', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const frameNumber = parseInt(req.body.frameNumber);
  if (isNaN(frameNumber)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid frame number' });
  }

  const videoPath = req.file.path;
  const outputPath = `/tmp/${uuidv4()}.png`;

  const ffmpegCommand = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -vframes 1 "${outputPath}" -y`;

  exec(ffmpegCommand, (error, stdout, stderr) => {
    fs.unlinkSync(videoPath);

    if (error) {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }

    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }

    const stat = fs.statSync(outputPath);
    if (stat.size === 0) {
      fs.unlinkSync(outputPath);
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }

    res.setHeader('Content-Type', 'image/png');
    const fileStream = fs.createReadStream(outputPath);
    
    fileStream.on('end', () => {
      fs.unlinkSync(outputPath);
    });

    fileStream.on('error', () => {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      res.status(500).json({ error: 'Error reading output file' });
    });

    fileStream.pipe(res);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
</CODE>