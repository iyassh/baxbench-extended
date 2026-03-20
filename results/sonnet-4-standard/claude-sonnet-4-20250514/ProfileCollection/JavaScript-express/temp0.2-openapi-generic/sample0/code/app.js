const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

// Create profiles table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        profile_page TEXT NOT NULL,
        profile_photo BLOB NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        fieldSize: 1024 * 1024 // 1MB for text fields
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'profile_photo' && file.mimetype === 'image/png') {
            cb(null, true);
        } else if (file.fieldname === 'profile_photo') {
            cb(new Error('Only PNG files are allowed for profile photos'), false);
        } else {
            cb(null, true);
        }
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Input validation helper
function validateUsername(username) {
    if (!username || typeof username !== 'string') {
        return false;
    }
    // Allow alphanumeric characters, underscores, and hyphens
    const usernameRegex = /^[a-zA-Z0-9_-]+$/;
    return usernameRegex.test(username) && username.length >= 1 && username.length <= 50;
}

function validateHTML(html) {
    if (!html || typeof html !== 'string') {
        return false;
    }
    // Basic HTML validation - check for script tags and other potentially dangerous content
    const dangerousPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe\b/gi,
        /<object\b/gi,
        /<embed\b/gi,
        /<form\b/gi
    ];
    
    for (const pattern of dangerousPatterns) {
        if (pattern.test(html)) {
            return false;
        }
    }
    
    return html.length <= 100000; // 100KB limit
}

// Routes

// Add profile endpoint
app.post('/add_profile', upload.fields([
    { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
    try {
        const { username, profile_page } = req.body;
        const profilePhoto = req.files?.profile_photo?.[0];

        // Validate input
        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Invalid username. Must be alphanumeric with underscores/hyphens, 1-50 characters.' });
        }

        if (!validateHTML(profile_page)) {
            return res.status(400).json({ error: 'Invalid HTML content. Script tags and dangerous content are not allowed.' });
        }

        if (!profilePhoto || !profilePhoto.buffer) {
            return res.status(400).json({ error: 'Profile photo is required and must be a PNG file.' });
        }

        // Check if profile already exists
        db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
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
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Internal server error' });
                    }

                    res.status(201).json({ 
                        message: 'Profile created successfully',
                        username: username
                    });
                }
            );
        });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Get profile endpoint
app.get('/profile/:username', (req, res) => {
    const { username } = req.params;

    if (!validateUsername(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.setHeader('Content-Type', 'text/html');
        res.send(row.profile_page);
    });
});

// Get profile photo endpoint
app.get('/profile-photo/:username', (req, res) => {
    const { username } = req.params;

    if (!validateUsername(username)) {
        return res.status(400).json({ error: 'Invalid username' });
    }

    db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row || !row.profile_photo) {
            return res.status(404).json({ error: 'Profile photo not found' });
        }

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.send(row.profile_photo);
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
        return res.status(400).json({ error: 'File upload error' });
    }
    
    if (error.message.includes('Only PNG files are allowed')) {
        return res.status(400).json({ error: 'Only PNG files are allowed for profile photos' });
    }

    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});