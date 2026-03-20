const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        profile_page TEXT NOT NULL,
        profile_photo BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Configure multer for file uploads with size limits
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        fieldSize: 1024 * 1024, // 1MB for text fields
        fields: 10,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'profile_photo' && file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only PNG files are allowed for profile photos'), false);
        }
    }
});

// Middleware for parsing form data
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Input validation and sanitization functions
function validateUsername(username) {
    if (!username || typeof username !== 'string') {
        return false;
    }
    // Allow alphanumeric characters, underscores, and hyphens, 3-30 characters
    return /^[a-zA-Z0-9_-]{3,30}$/.test(username);
}

function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    // Basic HTML sanitization - remove script tags and dangerous attributes
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/on\w+\s*=\s*'[^']*'/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/data:/gi, '')
        .substring(0, 50000); // Limit HTML size
}

// Error handling middleware
function handleError(res, error, statusCode = 500) {
    console.error('Error:', error.message);
    res.status(statusCode).json({ error: 'An error occurred' });
}

// POST /add_profile - Add a new user profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
    try {
        const { username, profile_page } = req.body;
        const profilePhoto = req.file;

        // Validate input
        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }

        if (!profile_page || typeof profile_page !== 'string') {
            return res.status(400).json({ error: 'Profile page content is required' });
        }

        if (!profilePhoto) {
            return res.status(400).json({ error: 'Profile photo is required' });
        }

        // Sanitize HTML content
        const sanitizedProfilePage = sanitizeHtml(profile_page);

        // Check if profile already exists
        db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                return handleError(res, err);
            }

            if (row) {
                return res.status(403).json({ error: 'Profile already exists' });
            }

            // Insert new profile
            const stmt = db.prepare('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)');
            stmt.run([username, sanitizedProfilePage, profilePhoto.buffer], function(err) {
                if (err) {
                    return handleError(res, err);
                }
                res.status(201).json({ message: 'Profile created successfully' });
            });
            stmt.finalize();
        });

    } catch (error) {
        handleError(res, error, 400);
    }
});

// GET /profile/:username - Get user profile HTML
app.get('/profile/:username', (req, res) => {
    try {
        const username = req.params.username;

        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }

        db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                return handleError(res, err);
            }

            if (!row) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            res.setHeader('Content-Type', 'text/html');
            res.send(row.profile_page);
        });

    } catch (error) {
        handleError(res, error);
    }
});

// GET /profile-photo/:username - Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
    try {
        const username = req.params.username;

        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }

        db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                return handleError(res, err);
            }

            if (!row || !row.profile_photo) {
                return res.status(404).json({ error: 'Profile photo not found' });
            }

            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(row.profile_photo);
        });

    } catch (error) {
        handleError(res, error);
    }
});

// Handle multer errors
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Unexpected file field' });
        }
    }
    if (error.message === 'Only PNG files are allowed for profile photos') {
        return res.status(400).json({ error: 'Only PNG files are allowed' });
    }
    handleError(res, error, 400);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    handleError(res, err);
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});