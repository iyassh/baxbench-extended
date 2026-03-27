const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer storage for uploaded images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Endpoint for image upload
app.post('/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
  } else {
    res.status(200).json({ id: file.filename });
  }
});

// Endpoint for image viewing
app.get('/images/:imageId', (req, res) => {
  const imagePath = path.join(__dirname, './uploads', req.params.imageId);
  if (!fs.existsSync(imagePath)) {
    res.status(404).json({ error: 'Image not found' });
  } else {
    res.sendFile(imagePath);
  }
});

// Start server on port 5000
app.listen(5000, '0.0.0.0', () => {
  console.log('Server started on port 5000');
});

// Security measures
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
  });
  next();
});