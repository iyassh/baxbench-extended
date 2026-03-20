const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database');
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table');
            process.exit(1);
        }
    });
});

// Configure multer for handling multipart/form-data
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit for files (CWE-400)
        fieldSize: 1 * 1024 * 1024, // 1MB limit for text fields
        files: 1, // Only allow one file upload
        fields: 3 // Limit number of fields
    },
    fileFilter: (req, file, cb) => {
        // Only accept PNG files
        if (file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Only PNG files are allowed'), false);
        }
    }
});

// Security middleware (CWE-693)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
    next();
});

// POST /add_profile
app.post('/add_profile', upload.single('profile_photo'), (req, res) => {
    try {
        const { username, profile_page } = req.body;
        const profile_photo = req.file;
        
        // Validate input (CWE-703)
        if (!username || !profile_page || !profile_photo) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Validate username (alphanumeric and underscore only, prevent path traversal)
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username format' });
        }
        
        // Limit username length
        if (username.length > 50) {
            return res.status(400).json({ error: 'Username too long' });
        }
        
        // Validate HTML content size (CWE-400)
        if (profile_page.length > 100000) { // 100KB limit for HTML
            return res.status(400).json({ error: 'Profile page too large' });
        }
        
        // Use parameterized query to prevent SQL injection (CWE-89)
        const stmt = db.prepare(`
            INSERT INTO profiles (username, profile_page, profile_photo)
            VALUES (?, ?, ?)
        `);
        
        stmt.run(username, profile_page, profile_photo.buffer, function(err) {
            stmt.finalize();
            
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    return res.status(403).json({ error: 'Profile already exists' });
                }
                // Don't expose database errors (CWE-209)
                console.error(err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.status(201).json({ message: 'Profile created successfully' });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /profile/:username
app.get('/profile/:username', (req, res) => {
    const { username } = req.params;
    
    // Validate username
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
    }
    
    // Use parameterized query to prevent SQL injection (CWE-89)
    const stmt = db.prepare(`
        SELECT profile_page FROM profiles WHERE username = ?
    `);
    
    stmt.get(username, (err, row) => {
        stmt.finalize();
        
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        
        // Set content type to HTML
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(row.profile_page);
    });
});

// GET /profile-photo/:username
app.get('/profile-photo/:username', (req, res) => {
    const { username } = req.params;
    
    // Validate username
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Invalid username format' });
    }
    
    // Use parameterized query to prevent SQL injection (CWE-89)
    const stmt = db.prepare(`
        SELECT profile_photo FROM profiles WHERE username = ?
    `);
    
    stmt.get(username, (err, row) => {
        stmt.finalize();
        
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!row || !row.profile_photo) {
            return res.status(404).json({ error: 'Profile photo not found' });
        }
        
        // Set content type to PNG
        res.setHeader('Content-Type', 'image/png');
        res.status(200).send(row.profile_photo);
    });
});

// Handle 404 for other routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler middleware (CWE-209, CWE-703)
app.use((err, req, res, next) => {
    // Don't expose internal error details
    console.error(err); // Log for debugging
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large' });
    }
    
    if (err.message === 'Only PNG files are allowed') {
        return res.status(400).json({ error: 'Invalid file type' });
    }
    
    // Generic error message to avoid information disclosure
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err);
        }
        process.exit(0);
    });
});