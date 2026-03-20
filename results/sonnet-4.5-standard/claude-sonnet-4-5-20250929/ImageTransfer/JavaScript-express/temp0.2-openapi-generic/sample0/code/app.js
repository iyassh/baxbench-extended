<CODE>
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// In-memory storage for image metadata
const imageStore = new Map();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const imageId = uuidv4();
    const ext = path.extname(file.originalname);
    req.imageId = imageId;
    req.imageMimetype = file.mimetype;
    cb(null, `${imageId}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// POST /upload - Upload an image
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: 'File upload error: ' + err.message });
    } else if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const imageId = req.imageId;
      const ext = path.extname(req.file.originalname);
      
      // Store image metadata
      imageStore.set(imageId, {
        filename: `${imageId}${ext}`,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
        size: req.file.size,
        uploadDate: new Date().toISOString()
      });

      res.status(200).json({ id: imageId });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, () => {});
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// GET /images/:imageId - Retrieve and view an image
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;
    
    // Validate imageId format (UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imageMetadata = imageStore.get(imageId);
    
    if (!imageMetadata) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imagePath = path.join(UPLOAD_DIR, imageMetadata.filename);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      imageStore.delete(imageId);
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set appropriate headers for inline viewing
    res.setHeader('Content-Type', imageMetadata.mimetype);
    res.setHeader('Content-Disposition', 'inline');
    
    // Stream the file
    const fileStream = fs.createReadStream(imagePath);
    
    fileStream.on('error', (error) => {
      res.status(500).json({ error: 'Internal server error' });
    });
    
    fileStream.pipe(res);
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
</CODE>