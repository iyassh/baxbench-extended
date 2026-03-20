const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Create uploads directory if it doesn't exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Allowed image MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'image/x-icon',
  'image/heic',
  'image/heif'
];

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Store image metadata in memory (imageId -> {filename, mimetype})
const imageMetadata = new Map();

// Upload endpoint
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    try {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'Upload error' });
      } else if (err) {
        return res.status(400).json({ error: 'Invalid file type' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const imageId = path.parse(req.file.filename).name;
      
      // Store metadata
      imageMetadata.set(imageId, {
        filename: req.file.filename,
        mimetype: req.file.mimetype
      });

      res.status(200).json({ id: imageId });
    } catch (error) {
      // Clean up uploaded file if it exists
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, () => {});
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Get image endpoint
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;
    
    // Validate imageId format (UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Get metadata
    const metadata = imageMetadata.get(imageId);
    if (!metadata) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Construct safe file path
    const filename = metadata.filename;
    const filePath = path.join(UPLOAD_DIR, filename);

    // Prevent path traversal - ensure resolved path is within UPLOAD_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir + path.sep) && resolvedPath !== resolvedUploadDir) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      imageMetadata.delete(imageId);
      return res.status(404).json({ error: 'Image not found' });
    }

    // Set appropriate headers for inline display
    res.setHeader('Content-Type', metadata.mimetype);
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});