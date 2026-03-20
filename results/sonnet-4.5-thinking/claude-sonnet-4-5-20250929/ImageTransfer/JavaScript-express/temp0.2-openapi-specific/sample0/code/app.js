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

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Store image metadata in memory
const imageStore = new Map();

// Sanitize file extension
function sanitizeExtension(ext) {
  return ext.toLowerCase().replace(/[^a-z0-9.]/g, '').substring(0, 10);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    const sanitizedExt = sanitizeExtension(ext);
    cb(null, `${id}${sanitizedExt}`);
  }
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// POST /upload endpoint
app.post('/upload', (req, res) => {
  const uploadSingle = upload.single('file');
  
  uploadSingle(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: 'File upload error' });
    } else if (err) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    try {
      const filename = req.file.filename;
      const id = path.parse(filename).name;
      
      imageStore.set(id, {
        filename: filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
        uploadDate: new Date().toISOString()
      });
      
      res.status(200).json({ id: id });
    } catch (error) {
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// GET /images/:imageId endpoint
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;
    
    // Validate imageId format (UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Check if image exists in store
    const imageMetadata = imageStore.get(imageId);
    if (!imageMetadata) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    const filename = imageMetadata.filename;
    
    // Validate filename starts with the UUID
    if (!filename.startsWith(imageId)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    const filePath = path.join(UPLOAD_DIR, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Verify file is in upload directory (prevent path traversal)
    try {
      const realFilePath = fs.realpathSync(filePath);
      const realUploadDir = fs.realpathSync(UPLOAD_DIR);
      const relativePath = path.relative(realUploadDir, realFilePath);
      
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return res.status(404).json({ error: 'Image not found' });
      }
      
      // Set headers for inline viewing
      res.setHeader('Content-Type', imageMetadata.mimetype);
      res.setHeader('Content-Disposition', 'inline');
      
      // Stream the file
      const fileStream = fs.createReadStream(realFilePath);
      
      fileStream.on('error', (error) => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
      
      fileStream.pipe(res);
    } catch (pathError) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});