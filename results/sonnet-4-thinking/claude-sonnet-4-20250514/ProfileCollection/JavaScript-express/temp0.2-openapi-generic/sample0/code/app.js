const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();
const PORT = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create profiles table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL
    )`);
});

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        fieldSize: 1024 * 1024 // 1MB for text fields
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'profile_photo') {
            if (file.mimetype === 'image/png') {
                cb(null, true);
            } else {
                cb(new Error('Only PNG files are allowed'), false);
            }
        } else {
            cb(null, true);
        }
    }
});

// Middleware
app.use(express.urlencoded({ extended: true }));

// POST /add_profile
app.post('/add_profile', upload.fields([
    { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
    try {
        const { username, profile_page } = req.body;
        const profilePhoto = req.files?.profile_photo?.[0];

        // Validate input
        if (!username || !profile_page || !profilePhoto) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate username (basic sanitization)
        if (typeof username !== 'string' || username.length === 0 || username.length > 100) {
            return res.status(400).json({ error: 'Invalid username' });
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(400).json({ error: 'Username can only contain alphanumeric characters, underscores, and hyphens' });
        }

        // Check if profile already exists
        db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (row) {
                return res.status(403).json({ error: 'Profile already exists' });
            }

            // Insert new profile
            db.run(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                [username, profile_page, profilePhoto.buffer],
                function(err) {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: 'Database error' });
                    }
                    res.status(201).json({ message: 'Profile created successfully' });
                }
            );
        });

    } catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
    const { username } = req.params;

    // Validate username
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Invalid username' });
    }

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.set('Content-Type', 'text/html');
        res.send(row.profile_page);
    });
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
    const { username } = req.params;

    // Validate username
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Invalid username' });
    }

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Profile photo not found' });
        }

        res.set('Content-Type', 'image/png');
        res.send(row.profile_photo);
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
    }
    if (error.message === 'Only PNG files are allowed') {
        return res.status(400).json({ error: 'Only PNG files are allowed' });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
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