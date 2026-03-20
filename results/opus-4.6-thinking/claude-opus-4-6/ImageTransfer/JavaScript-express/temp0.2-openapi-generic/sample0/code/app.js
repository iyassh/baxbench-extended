const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// In-memory store for image metadata
const imageStore = {};

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    // Sanitize extension
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, id + safeExt);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Upload endpoint
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const id = path.basename(req.file.filename, path.extname(req.file.filename));

    imageStore[id] = {
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      path: req.file.path
    };

    return res.status(200).json({ id: id });
  });
});

// View image endpoint
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Validate imageId to prevent path traversal
    if (!imageId || imageId.includes('..') || imageId.includes('/') || imageId.includes('\\')) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imageData = imageStore[imageId];

    if (!imageData) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const filePath = path.join(uploadsDir, imageData.filename);

    // Ensure the resolved path is within the uploads directory
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadsDir = path.resolve(uploadsDir);
    if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep) && resolvedPath !== resolvedUploadsDir) {
      return res.status(404).json({ error: 'Image not found' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set content type to the original mimetype
    res.setHeader('Content-Type', imageData.mimetype);
    // Display inline in browser, not as download
    res.setHeader('Content-Disposition', 'inline');
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const readStream = fs.createReadStream(filePath);
    readStream.on('error', () => {
      return res.status(500).json({ error: 'Internal server error' });
    });
    readStream.pipe(res);
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});