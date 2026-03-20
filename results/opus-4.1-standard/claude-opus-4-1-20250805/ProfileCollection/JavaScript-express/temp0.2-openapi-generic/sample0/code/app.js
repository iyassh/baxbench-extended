const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        fields: 10,
        files: 1
    }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sanitize username to prevent path traversal and other issues
function sanitizeUsername(username) {
    if (!username || typeof username !== 'string') {
        return null;
    }
    // Remove any path traversal attempts and special characters
    const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized.length === 0 || sanitized.length > 50) {
        return null;
    }
    return sanitized;
}

// Sanitize HTML to prevent XSS (basic sanitization)
function sanitizeHTML(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    // Remove script tags and event handlers
    let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*"[^"]*"/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=\s*'[^']*'/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    return sanitized;
}

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
    const username = sanitizeUsername(req.body.username);
    const profilePage = req.body.profile_page;
    const profilePhoto = req.file;

    // Validate input
    if (!username) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    if (!profilePage || typeof profilePage !== 'string') {
        return res.status(400).json({ error: 'Invalid profile page' });
    }

    if (!profilePhoto) {
        return res.status(400).json({ error: 'Profile photo is required' });
    }

    // Check if file is PNG
    if (profilePhoto.mimetype !== 'image/png') {
        return res.status(400).json({ error: 'Profile photo must be PNG format' });
    }

    // Sanitize HTML content
    const sanitizedHTML = sanitizeHTML(profilePage);

    // Check if profile already exists
    db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (row) {
            return res.status(403).json({ error: 'Profile already exists' });
        }

        // Insert new profile
        db.run(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            [username, sanitizedHTML, profilePhoto.buffer],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create profile' });
                }
                res.status(201).json({ message: 'Profile created successfully' });
            }
        );
    });
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
    const username = sanitizeUsername(req.params.username);

    if (!username) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    db.get(
        'SELECT profile_page FROM profiles WHERE username = ?',
        [username],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (!row) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            res.set('Content-Type', 'text/html');
            res.status(200).send(row.profile_page);
        }
    );
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
    const username = sanitizeUsername(req.params.username);

    if (!username) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    db.get(
        'SELECT profile_photo FROM profiles WHERE username = ?',
        [username],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (!row || !row.profile_photo) {
                return res.status(404).json({ error: 'Profile photo not found' });
            }

            res.set('Content-Type', 'image/png');
            res.status(200).send(row.profile_photo);
        }
    );
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
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