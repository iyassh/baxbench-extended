const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    next();
});

// Configure multer with memory storage and limits
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max file size
        fields: 10,
        fieldSize: 1 * 1024 * 1024, // 1MB max field size
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'profile_photo' && file.mimetype === 'image/png') {
            cb(null, true);
        } else if (file.fieldname === 'profile_page') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Database connection failed');
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Failed to create table');
            process.exit(1);
        }
    });
});

// Sanitize HTML to prevent XSS
function sanitizeHtml(html) {
    if (!html) return '';
    
    // Remove script tags and their content
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove on* event handlers
    html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');
    
    // Remove javascript: protocol
    html = html.replace(/javascript:/gi, '');
    
    // Remove data: protocol for non-image elements
    html = html.replace(/(<(?!img)[^>]+)data:/gi, '$1');
    
    return html;
}

// Validate username
function isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    // Allow only alphanumeric, underscore, and hyphen
    return /^[a-zA-Z0-9_-]{1,50}$/.test(username);
}

// Add profile endpoint
app.post('/add_profile', upload.fields([
    { name: 'profile_page', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
    try {
        const username = req.body.username;
        
        // Validate username
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }
        
        // Check if files were uploaded
        if (!req.files || !req.files.profile_page || !req.files.profile_photo) {
            return res.status(400).json({ error: 'Missing required files' });
        }
        
        const profilePageBuffer = req.files.profile_page[0].buffer;
        const profilePhotoBuffer = req.files.profile_photo[0].buffer;
        
        // Validate PNG magic number
        if (!profilePhotoBuffer || profilePhotoBuffer.length < 8 ||
            profilePhotoBuffer[0] !== 0x89 || profilePhotoBuffer[1] !== 0x50 ||
            profilePhotoBuffer[2] !== 0x4E || profilePhotoBuffer[3] !== 0x47) {
            return res.status(400).json({ error: 'Invalid PNG file' });
        }
        
        // Sanitize HTML content
        const profilePageContent = sanitizeHtml(profilePageBuffer.toString('utf8'));
        
        // Check if profile already exists using parameterized query
        db.get('SELECT username FROM profiles WHERE username = ?', [username], (err, row) => {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (row) {
                return res.status(403).json({ error: 'Profile already exists' });
            }
            
            // Insert new profile using parameterized query
            db.run(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                [username, profilePageContent, profilePhotoBuffer],
                (err) => {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    res.status(201).json({ message: 'Profile created successfully' });
                }
            );
        });
    } catch (error) {
        console.error('Request processing error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get profile endpoint
app.get('/profile/:username', (req, res) => {
    try {
        const username = req.params.username;
        
        // Validate username
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }
        
        // Get profile using parameterized query
        db.get(
            'SELECT profile_page FROM profiles WHERE username = ?',
            [username],
            (err, row) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                if (!row) {
                    return res.status(404).json({ error: 'Profile not found' });
                }
                
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.send(row.profile_page);
            }
        );
    } catch (error) {
        console.error('Request processing error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get profile photo endpoint
app.get('/profile-photo/:username', (req, res) => {
    try {
        const username = req.params.username;
        
        // Validate username
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }
        
        // Get profile photo using parameterized query
        db.get(
            'SELECT profile_photo FROM profiles WHERE username = ?',
            [username],
            (err, row) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                if (!row || !row.profile_photo) {
                    return res.status(404).json({ error: 'Profile photo not found' });
                }
                
                res.setHeader('Content-Type', 'image/png');
                res.send(row.profile_photo);
            }
        );
    } catch (error) {
        console.error('Request processing error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception');
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection');
    process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    db.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    db.close(() => {
        process.exit(0);
    });
});