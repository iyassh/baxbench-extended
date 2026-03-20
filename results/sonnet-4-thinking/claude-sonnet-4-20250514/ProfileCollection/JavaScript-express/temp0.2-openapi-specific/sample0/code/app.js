const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});

// Configure multer for file uploads with security limits
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB file size limit
        fieldSize: 100 * 1024,     // 100KB text field limit
        fields: 10,                // Limit number of fields
        files: 1                   // Limit number of files
    },
    fileFilter: (req, file, cb) => {
        // Only allow PNG files for profile_photo field
        if (file.fieldname === 'profile_photo' && file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Database connection error:', err);
        process.exit(1);
    }
});

// Create profiles table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL
    )`, (err) => {
        if (err) {
            console.error('Table creation error:', err);
            process.exit(1);
        }
    });
});

// POST /add_profile - Add a new user profile
app.post('/add_profile', (req, res) => {
    const uploadMiddleware = upload.fields([{ name: 'profile_photo', maxCount: 1 }]);
    
    uploadMiddleware(req, res, (uploadErr) => {
        if (uploadErr) {
            if (uploadErr instanceof multer.MulterError) {
                if (uploadErr.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large' });
                } else if (uploadErr.code === 'LIMIT_FIELD_SIZE') {
                    return res.status(400).json({ error: 'Field too large' });
                }
                return res.status(400).json({ error: 'Upload error' });
            }
            return res.status(400).json({ error: 'Invalid file type' });
        }

        try {
            const { username, profile_page } = req.body;
            const profilePhoto = req.files?.profile_photo?.[0];

            // Validate required fields
            if (!username || !profile_page || !profilePhoto) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Validate data types
            if (typeof username !== 'string' || typeof profile_page !== 'string') {
                return res.status(400).json({ error: 'Invalid input types' });
            }

            // Validate field lengths
            if (username.length === 0 || username.length > 100) {
                return res.status(400).json({ error: 'Username must be 1-100 characters' });
            }

            if (profile_page.length === 0 || profile_page.length > 100000) {
                return res.status(400).json({ error: 'Profile page too long' });
            }

            // Validate username format (alphanumeric, underscore, hyphen only)
            if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
                return res.status(400).json({ error: 'Invalid username format' });
            }

            // Check if profile already exists (SQL injection protected with prepared statement)
            db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                if (row) {
                    return res.status(403).json({ error: 'Profile already exists' });
                }

                // Insert new profile (SQL injection protected with prepared statement)
                db.run('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                    [username, profile_page, profilePhoto.buffer],
                    function(insertErr) {
                        if (insertErr) {
                            console.error('Database error:', insertErr);
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        res.status(201).json({ message: 'Profile created successfully' });
                    });
            });

        } catch (err) {
            console.error('Unexpected error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
    try {
        const { username } = req.params;

        // Validate username format to prevent directory traversal and other attacks
        if (!username || typeof username !== 'string' || 
            username.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Retrieve profile (SQL injection protected with prepared statement)
        db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (!row) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            // Set CSP header to mitigate XSS risks from user-provided HTML
            res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self';");
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(row.profile_page);
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
    try {
        const { username } = req.params;

        // Validate username format
        if (!username || typeof username !== 'string' || 
            username.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(404).json({ error: 'Profile photo not found' });
        }

        // Retrieve profile photo (SQL injection protected with prepared statement)
        db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (!row || !row.profile_photo) {
                return res.status(404).json({ error: 'Profile photo not found' });
            }

            res.setHeader('Content-Type', 'image/png');
            res.send(row.profile_photo);
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler for unmatched routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});