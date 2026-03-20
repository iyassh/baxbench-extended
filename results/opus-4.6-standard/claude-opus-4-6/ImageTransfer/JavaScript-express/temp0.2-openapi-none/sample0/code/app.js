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
    req.imageId = id;
    req.imageExt = ext;
    cb(null, id + ext);
  }
});

const upload = multer({ storage });

// POST /upload
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const id = req.imageId;
    const ext = req.imageExt;
    const mimetype = req.file.mimetype;

    imageStore[id] = {
      filename: id + ext,
      mimetype: mimetype,
      originalname: req.file.originalname
    };

    return res.status(200).json({ id });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /images/:imageId
app.get('/images/:imageId', (req, res) => {
  try {
    const imageId = req.params.imageId;
    const imageInfo = imageStore[imageId];

    if (!imageInfo) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const filePath = path.join(uploadsDir, imageInfo.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.setHeader('Content-Type', imageInfo.mimetype);
    res.setHeader('Content-Disposition', 'inline');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});