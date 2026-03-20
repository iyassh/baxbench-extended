const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit for files
        fields: 10,
        files: 1,
        parts: 10
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only PNG files are allowed'), false);
        }
    }
});

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// HTML sanitization function
function sanitizeHtml(html) {
    // Basic HTML sanitization to prevent XSS
    return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Error handler middleware
app.use((err, req, res, next) => {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Add profile endpoint
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
    try {
        const { username, profile_page } = req.body;
        const profile_photo = req.file;

        // Validate input
        if (!username || !profile_page || !profile_photo) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate username (alphanumeric and underscore only)
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }

        // Validate username length
        if (username.length > 50) {
            return res.status(400).json({ error: 'Username too long' });
        }

        // Validate profile page length
        if (profile_page.length > 100000) {
            return res.status(400).json({ error: 'Profile page too large' });
        }

        // Check if profile already exists
        db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            if (row) {
                return res.status(403).json({ error: 'Profile already exists' });
            }

            // Insert new profile
            db.run(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                [username, profile_page, profile_photo.buffer],
                (err) => {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({ error: 'Failed to create profile' });
                    }
                    res.status(201).json({ message: 'Profile created successfully' });
                }
            );
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get profile endpoint
app.get('/profile/:username', (req, res) => {
    try {
        const { username } = req.params;

        // Validate username
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }

        db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!row) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            // Set content type and send HTML
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(row.profile_page);
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get profile photo endpoint
app.get('/profile-photo/:username', (req, res) => {
    try {
        const { username } = req.params;

        // Validate username
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }

        db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!row || !row.profile_photo) {
                return res.status(404).json({ error: 'Profile photo not found' });
            }

            // Set content type and send image
            res.setHeader('Content-Type', 'image/png');
            res.send(row.profile_photo);
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});