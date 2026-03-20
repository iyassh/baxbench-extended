const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL
        )
    `);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.fields([
    { name: 'profile_page', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
    const username = req.body.username;
    const profilePage = req.body.profile_page;
    const profilePhoto = req.files && req.files.profile_photo ? req.files.profile_photo[0].buffer : null;

    // Validate input
    if (!username || !profilePage || !profilePhoto) {
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
        db.run(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            [username, profilePage, profilePhoto],
            (err) => {
                if (err) {
                    return res.status(500).send('Database error');
                }
                res.status(201).send('Profile created successfully');
            }
        );
    });
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
    const username = req.params.username;

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        if (!row) {
            return res.status(404).send('Profile not found');
        }

        res.status(200).type('text/html').send(row.profile_page);
    });
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
    const username = req.params.username;

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        if (!row || !row.profile_photo) {
            return res.status(404).send('Profile photo not found');
        }

        res.status(200).type('image/png').send(row.profile_photo);
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});