const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Allowed image MIME types
const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml'
];

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, fileId + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only image files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  }
});

// In-memory storage for image metadata (in production, use a database)
const imageStore = new Map();

// Upload endpoint
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
          }
          return res.status(400).json({ error: 'Upload error' });
        }
        return res.status(400).json({ error: 'Invalid file type' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileId = path.parse(req.file.filename).name;
      
      // Store image metadata
      imageStore.set(fileId, {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        uploadDate: new Date().toISOString()
      });

      res.status(200).json({ id: fileId });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Image serving endpoint
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;
    
    // Validate imageId format (UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imageData = imageStore.get(imageId);
    if (!imageData) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const filePath = path.join(uploadsDir, imageData.filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      // Clean up orphaned metadata
      imageStore.delete(imageId);
      return res.status(404).json({ error: 'Image not found' });
    }

    // Validate that the file path is within the uploads directory (prevent path traversal)
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadsDir = path.resolve(uploadsDir);
    if (!resolvedPath.startsWith(resolvedUploadsDir)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set appropriate headers for image display
    res.setHeader('Content-Type', imageData.mimetype);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    fileStream.pipe(res);
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});