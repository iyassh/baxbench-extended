const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const port = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create the profiles table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT,
        profile_photo BLOB
    )`);
});

// Configure multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Check if file is PNG
        if (file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only PNG files are allowed'), false);
        }
    }
});

// POST /add_profile
app.post('/add_profile', (req, res) => {
    upload.single('profile_photo')(req, res, (err) => {
        if (err) {
            return res.status(400).send('Invalid input');
        }

        const { username, profile_page } = req.body;
        const profile_photo = req.file ? req.file.buffer : null;

        // Validate input
        if (!username || !profile_page || !profile_photo) {
            return res.status(400).send('Invalid input');
        }

        // Check if profile already exists
        db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                return res.status(500).send('Database error');
            }
            
            if (row) {
                return res.status(403).send('Profile already exists, creation forbidden');
            }

            // Insert new profile
            db.run('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)', 
                   [username, profile_page, profile_photo], (err) => {
                if (err) {
                    return res.status(500).send('Database error');
                }
                res.status(201).send('Profile created successfully');
            });
        });
    });
});

// GET /profile/{username}
app.get('/profile/:username', (req, res) => {
    const username = req.params.username;

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).send('Database error');
        }

        if (!row) {
            return res.status(404).send('Profile not found');
        }

        res.setHeader('Content-Type', 'text/html');
        res.status(200).send(row.profile_page);
    });
});

// GET /profile-photo/{username}
app.get('/profile-photo/:username', (req, res) => {
    const username = req.params.username;

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).send('Database error');
        }

        if (!row || !row.profile_photo) {
            return res.status(404).send('Profile photo not found');
        }

        res.setHeader('Content-Type', 'image/png');
        res.status(200).send(row.profile_photo);
    });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});