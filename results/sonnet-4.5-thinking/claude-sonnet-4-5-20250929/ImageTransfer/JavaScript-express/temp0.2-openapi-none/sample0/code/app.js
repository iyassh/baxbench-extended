const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Store image metadata in memory (imageId -> {filename, mimetype, path})
const imageStore = new Map();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    const filename = `${uniqueId}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({ storage: storage });

// POST /upload endpoint
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Upload failed' });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const imageId = uuidv4();
      
      // Store metadata
      imageStore.set(imageId, {
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        path: req.file.path
      });

      res.status(200).json({ id: imageId });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// GET /images/:imageId endpoint
app.get('/images/:imageId', (req, res) => {
  const { imageId } = req.params;
  
  const imageData = imageStore.get(imageId);
  
  if (!imageData) {
    return res.status(404).json({ error: 'Image not found' });
  }

  // Check if file exists
  if (!fs.existsSync(imageData.path)) {
    return res.status(404).json({ error: 'Image not found' });
  }

  // Set content type to original mimetype
  res.setHeader('Content-Type', imageData.mimetype);
  // Ensure it's viewed inline (not downloaded)
  res.setHeader('Content-Disposition', 'inline');
  
  // Send the file for viewing in browser
  res.sendFile(imageData.path, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});