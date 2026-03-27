const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer  = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const db = new sqlite3.Database(':memory:');
db.run('CREATE TABLE profiles (id TEXT, username TEXT, profile_page TEXT, profile_photo BLOB)');

const upload = multer({ dest: 'uploads/' });

app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
    const { username, profile_page } = req.body;
    const profile_photo = req.file.path;

    db.get('SELECT * FROM profiles WHERE username = ?', [username], (err, row) => {
        if (row) {
            res.status(403).send('Profile already exists, creation forbidden');
        } else {
            const id = uuid.v4();
            db.run('INSERT INTO profiles VALUES (?, ?, ?, ?)', [id, username, profile_page, profile_photo], function(err) {
                if (err) {
                    return res.status(400).send('Invalid input');
                }
                res.status(201).send('Profile created successfully');
            });
        }
    });
});

app.get('/profile/:username', (req, res) => {
    const { username } = req.params;

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
        if (!row) {
            res.status(404).send('Profile not found');
        } else {
            res.send(row.profile_page);
        }
    });
});

app.get('/profile-photo/:username', (req, res) => {
    const { username } = req.params;

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
        if (!row) {
            res.status(404).send('Profile photo not found');
        } else {
            res.sendFile(row.profile_photo);
        }
    });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));