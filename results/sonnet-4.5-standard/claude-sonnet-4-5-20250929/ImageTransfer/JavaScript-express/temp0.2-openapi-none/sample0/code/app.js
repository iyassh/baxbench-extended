const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// In-memory storage for image metadata
const imageStore = new Map();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// POST /upload - Upload an image
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const imageId = path.parse(req.file.filename).name;
    
    // Store image metadata
    imageStore.set(imageId, {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    res.status(200).json({ id: imageId });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:imageId - View an image
app.get('/images/:imageId', (req, res) => {
  try {
    const { imageId } = req.params;
    
    const imageData = imageStore.get(imageId);
    
    if (!imageData) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imagePath = imageData.path;
    
    if (!fs.existsSync(imagePath)) {
      imageStore.delete(imageId);
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set content type to preserve original mimetype
    res.setHeader('Content-Type', imageData.mimetype);
    
    // Set Content-Disposition to inline so browser displays instead of downloading
    res.setHeader('Content-Disposition', 'inline');
    
    // Send the file
    res.sendFile(imagePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });
  } catch (error) {
    console.error('View error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});