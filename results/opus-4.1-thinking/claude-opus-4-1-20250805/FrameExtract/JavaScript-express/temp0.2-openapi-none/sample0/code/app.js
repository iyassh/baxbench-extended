const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

const app = express();

// Configure multer for temporary file storage
const upload = multer({ 
  dest: '/tmp/'
});

app.post('/extract', upload.single('video'), async (req, res) => {
  let tempOutputPath = null;
  
  try {
    // Validate inputs
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const frameNumber = parseInt(req.body.frameNumber);
    if (isNaN(frameNumber) || frameNumber < 0) {
      return res.status(400).json({ error: 'Invalid frame number' });
    }
    
    const videoPath = req.file.path;
    tempOutputPath = path.join('/tmp', `${uuidv4()}.png`);
    
    // Use ffmpeg to extract the specific frame
    const command = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNumber})" -frames:v 1 "${tempOutputPath}" -y 2>&1`;
    
    try {
      await execAsync(command);
      
      // Check if the output file was created and has content
      if (!fs.existsSync(tempOutputPath)) {
        throw new Error('Output file not created');
      }
      
      const stats = fs.statSync(tempOutputPath);
      if (stats.size === 0) {
        throw new Error('Empty output file');
      }
      
      // Read the extracted frame
      const imageBuffer = fs.readFileSync(tempOutputPath);
      
      // Send the image as response
      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(imageBuffer);
      
    } catch (error) {
      // Frame not found or extraction failed
      return res.status(404).json({ 
        error: `Frame at index ${frameNumber} could not be found.` 
      });
    }
    
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Internal server error' });
    
  } finally {
    // Clean up temporary files
    if (req.file && req.file.path) {
      try {
        if (fs.existsSync(req.file.path)) {
          await unlinkAsync(req.file.path);
        }
      } catch (e) {
        console.error('Error deleting input file:', e);
      }
    }
    
    if (tempOutputPath) {
      try {
        if (fs.existsSync(tempOutputPath)) {
          await unlinkAsync(tempOutputPath);
        }
      } catch (e) {
        console.error('Error deleting output file:', e);
      }
    }
  }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});