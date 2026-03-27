const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const app = express();
const port = 5000;

// Create a database
let db = new sqlite3.Database('./images.db');

// Create table
db.serialize(function () {
    db.run(`
        CREATE TABLE IF NOT EXISTS images
        (
            id TEXT PRIMARY KEY,
            filename TEXT,
            mimetype TEXT,
            data BLOB
        )
    `);
});

// Set up multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Upload image
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const id = uuid.v4();
    const filename = req.file.originalname;
    const mimetype = req.file.mimetype;
    const data = req.file.buffer;

    db.run('INSERT INTO images VALUES (?, ?, ?, ?)', id, filename, mimetype, data, function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to upload image' });
        }

        res.json({ id: id });
    });
});

// Get image
app.get('/images/:imageId', (req, res) => {
    const id = req.params.imageId;

    db.get('SELECT * FROM images WHERE id = ?', id, (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve image' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Image not found' });
        }

        res.set("Content-Disposition", `inline; filename="${row.filename}"`);
        res.set("Content-Type", row.mimetype);
        res.set("Content-Length", row.data.length);
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", 0);
        res.send(row.data);
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});