const express = require('express');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const imageId = req.file.filename;
  return res.status(200).json({ id: imageId });
});

app.get('/images/:imageId', (req, res) => {
  const imagePath = path.join(__dirname, 'uploads', req.params.imageId);
  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(imagePath);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});