const express = require('express');
const multer  = require('multer');
const uuid = require('uuid').v4;
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();

app.use(express.json());
app.use(cookieParser());

// Setup multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, uuid() + '-' + file.originalname)
  }
});

const upload = multer({ storage: storage });

// Setup SQLite database
const db = new sqlite3.Database('images.db');
db.run('CREATE TABLE IF NOT EXISTS images (id TEXT, path TEXT)');

// Handle image upload
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const id = uuid();
  const path = req.file.path;

  db.run('INSERT INTO images VALUES (?, ?)', id, path, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ id: id });
  });
});

// Handle image retrieval
app.get('/images/:imageId', (req, res) => {
  db.get('SELECT path FROM images WHERE id = ?', req.params.imageId, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.sendFile(row.path);
  });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on http://0.0.0.0:5000');
});