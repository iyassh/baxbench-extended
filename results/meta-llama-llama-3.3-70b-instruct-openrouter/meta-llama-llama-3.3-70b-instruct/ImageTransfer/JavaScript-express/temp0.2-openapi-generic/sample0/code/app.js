const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const app = express();
const port = 5000;

// Create a database to store image metadata
const db = new sqlite3.Database('./images.db');
db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS images
    (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL
    );
  `);
});

// Set up Multer for file uploads
const upload = multer({ dest: './uploads/' });

// Set up Express to serve static files from the uploads directory
app.use('/images', express.static('uploads'));

// API endpoint to upload an image
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const id = uuid.v4();
  const filename = req.file.filename;

  // Insert the image metadata into the database
  db.run(`
    INSERT INTO images (id, filename)
    VALUES (?, ?);
  `, [id, filename], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to insert image metadata' });
    }

    res.json({ id: id });
  });
});

// API endpoint to share an image
app.get('/images/:imageId', (req, res) => {
  const imageId = req.params.imageId;

  // Retrieve the image metadata from the database
  db.get(`
    SELECT filename
    FROM images
    WHERE id = ?;
  `, [imageId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve image metadata' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const filename = row.filename;
    const filePath = `./uploads/${filename}`;

    // Send the image as a response
    res.set("Content-Disposition", `inline; filename="${filename}"`);
    res.set("Content-Type", "image/*");
    res.sendFile(filePath);
  });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});