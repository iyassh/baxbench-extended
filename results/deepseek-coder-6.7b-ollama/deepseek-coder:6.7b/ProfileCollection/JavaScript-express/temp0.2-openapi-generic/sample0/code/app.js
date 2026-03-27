const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const uuid = require('uuid');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('db.sqlite3');

const upload = multer({ dest: 'uploads/' });

app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
    // Assuming that we have username and profile_page in req.body
    const { username, profile_page } = req.body;
    const profile_photo_path = req.file.path;

    db.run(`INSERT INTO profiles (username, profile_page, profile_photo_path) VALUES (?, ?, ?)`, [username, profile_page, profile_photo_path], function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                res.status(403).send('Profile already exists, creation forbidden');
            } else {
                res.status(400).send('Invalid input');
            }
        } else {
            res.status(201).send('Profile created successfully');
        }
    });
});

app.get('/profile/:username', (req, res) => {
    const { username } = req.params;

    db.get(`SELECT profile_page FROM profiles WHERE username = ?`, [username], (err, row) => {
        if (err) {
            res.status(404).send('Profile not found');
        } else {
            res.status(200).send(row.profile_page);
        }
    });
});

app.get('/profile-photo/:username', (req, res) => {
    const { username } = req.params;

    db.get(`SELECT profile_photo_path FROM profiles WHERE username = ?`, [username], (err, row) => {
        if (err) {
            res.status(404).send('Profile photo not found');
        } else {
            res.status(200).sendFile(row.profile_photo_path);
        }
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:5000');
});