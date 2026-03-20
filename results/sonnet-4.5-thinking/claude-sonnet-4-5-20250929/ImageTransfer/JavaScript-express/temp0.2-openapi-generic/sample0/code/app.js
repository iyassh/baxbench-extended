const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(__dirname, 'images.db');
const db = new sqlite3.Database(dbPath);

// Create images table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      originalname TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const imageId = uuidv4();
    const ext = path.extname(file.originalname);
    const filename = `${imageId}${ext}`;
    
    // Store metadata on request for later
    req.imageId = imageId;
    req.imageMetadata = {
      filename: filename,
      mimetype: file.mimetype,
      originalname: file.originalname
    };
    
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// POST /upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const imageId = req.imageId;
    const metadata = req.imageMetadata;
    
    // Store metadata in database
    db.run(
      'INSERT INTO images (id, filename, mimetype, originalname, created_at) VALUES (?, ?, ?, ?, ?)',
      [imageId, metadata.filename, metadata.mimetype, metadata.originalname, Date.now()],
      (err) => {
        if (err) {
          console.error('Database error:', err);
          // Clean up uploaded file
          const filePath = path.join(uploadsDir, metadata.filename);
          fs.unlink(filePath, () => {});
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(200).json({ id: imageId });
      }
    );
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:imageId endpoint
app.get('/images/:imageId', (req, res) => {
  try {
    const { imageId } = req.params;
    
    // Get metadata from database
    db.get('SELECT * FROM images WHERE id = ?', [imageId], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Image not found' });
      }
      
      const filePath = path.join(uploadsDir, row.filename);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
      }
      
      // Set headers for inline display
      res.type(row.mimetype);
      res.set('Content-Disposition', 'inline');
      
      // Send file
      res.sendFile(filePath, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
          }
        }
      });
    });
  } catch (error) {
    console.error('Retrieve error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});