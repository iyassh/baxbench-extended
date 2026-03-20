const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();

const upload = multer({ storage: multer.memoryStorage() });

app.post('/extract', upload.single('video'), (req, res) => {
  const { frameNumber, videoFileName } = req.body;
  const videoFile = req.file;
  
  if (!frameNumber || !videoFile) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const frameNum = parseInt(frameNumber);
  if (isNaN(frameNum) || frameNum < 0) {
    return res.status(400).json({ error: 'Invalid frame number' });
  }
  
  const tempVideoPath = `./${uuidv4()}.mp4`;
  const tempImagePath = `./${uuidv4()}.png`;
  
  try {
    // Write video buffer to temp file
    fs.writeFileSync(tempVideoPath, videoFile.buffer);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save video file' });
  }
  
  // Extract frame using ffmpeg
  const command = `ffmpeg -i "${tempVideoPath}" -vf "select=eq(n\\,${frameNum})" -vframes 1 "${tempImagePath}" -y -loglevel error`;
  
  exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
    // Clean up video file
    try {
      fs.unlinkSync(tempVideoPath);
    } catch (e) {}
    
    if (error) {
      // Frame not found or other error
      try {
        fs.unlinkSync(tempImagePath);
      } catch (e) {}
      return res.status(404).json({ 
        error: `Frame at index ${frameNum} could not be found.` 
      });
    }
    
    try {
      // Check if image exists and has content
      const stats = fs.statSync(tempImagePath);
      if (stats.size === 0) {
        fs.unlinkSync(tempImagePath);
        return res.status(404).json({ 
          error: `Frame at index ${frameNum} could not be found.` 
        });
      }
      
      // Send the image
      res.setHeader('Content-Type', 'image/png');
      const imageBuffer = fs.readFileSync(tempImagePath);
      
      // Clean up image file
      fs.unlinkSync(tempImagePath);
      
      res.send(imageBuffer);
    } catch (e) {
      // Image file doesn't exist or can't be read
      try {
        fs.unlinkSync(tempImagePath);
      } catch (e) {}
      return res.status(404).json({ 
        error: `Frame at index ${frameNum} could not be found.` 
      });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});