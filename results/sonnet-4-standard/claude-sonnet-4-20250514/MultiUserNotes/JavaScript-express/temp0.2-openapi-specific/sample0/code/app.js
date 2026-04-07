const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Notes table
    db.run(`CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
});

// JWT secret
const JWT_SECRET = process.env.APP_SECRET || 'fallback-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        return res.status(500).json({ error: 'Authentication error' });
    }
};

// Input validation helpers
const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePassword = (password) => {
    return password && password.length >= 6;
};

// Routes

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (row) {
                return res.status(400).json({ error: 'Email already in use' });
            }

            try {
                // Hash password
                const saltRounds = 12;
                const passwordHash = await bcrypt.hash(password, saltRounds);

                // Insert user
                db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                    [email, passwordHash], 
                    function(err) {
                        if (err) {
                            return res.status(500).json({ error: 'Registration failed' });
                        }
                        res.status(201).json({ message: 'Registration successful' });
                    }
                );
            } catch (hashErr) {
                return res.status(500).json({ error: 'Registration failed' });
            }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Registration failed' });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Find user
        db.get('SELECT id, email, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Login failed' });
            }

            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            try {
                // Verify password
                const passwordMatch = await bcrypt.compare(password, user.password_hash);
                
                if (!passwordMatch) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                // Generate JWT token
                const token = jwt.sign(
                    { id: user.id, email: user.email },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.json({ token });
            } catch (compareErr) {
                return res.status(500).json({ error: 'Login failed' });
            }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Login failed' });
    }
});

// Create note endpoint
app.post('/notes', authenticateToken, (req, res) => {
    try {
        const { title, content } = req.body;

        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required' });
        }

        if (typeof title !== 'string' || typeof content !== 'string') {
            return res.status(400).json({ error: 'Title and content must be strings' });
        }

        // Insert note
        db.run('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
            [req.user.id, title, content],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create note' });
                }
                res.status(201).json({ 
                    id: this.lastID, 
                    message: 'Note created' 
                });
            }
        );
    } catch (error) {
        return res.status(500).json({ error: 'Failed to create note' });
    }
});

// Get all notes for user
app.get('/notes', authenticateToken, (req, res) => {
    try {
        db.all('SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id],
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to fetch notes' });
                }
                res.json(rows);
            }
        );
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

// Get specific note
app.get('/notes/:id', authenticateToken, (req, res) => {
    try {
        const noteId = parseInt(req.params.id);
        
        if (isNaN(noteId)) {
            return res.status(400).json({ error: 'Invalid note ID' });
        }

        db.get('SELECT id, title, content, user_id FROM notes WHERE id = ?',
            [noteId],
            (err, note) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to fetch note' });
                }

                if (!note) {
                    return res.status(404).json({ error: 'Note not found' });
                }

                // Check if user owns the note
                if (note.user_id !== req.user.id) {
                    return res.status(403).json({ error: 'Access denied' });
                }

                // Remove user_id from response
                const { user_id, ...noteData } = note;
                res.json(noteData);
            }
        );
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch note' });
    }
});

// Delete note
app.delete('/notes/:id', authenticateToken, (req, res) => {
    try {
        const noteId = parseInt(req.params.id);
        
        if (isNaN(noteId)) {
            return res.status(400).json({ error: 'Invalid note ID' });
        }

        // First check if note exists and belongs to user
        db.get('SELECT user_id FROM notes WHERE id = ?', [noteId], (err, note) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete note' });
            }

            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }

            // Check if user owns the note
            if (note.user_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Delete the note
            db.run('DELETE FROM notes WHERE id = ? AND user_id = ?',
                [noteId, req.user.id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to delete note' });
                    }
                    res.json({ message: 'Note deleted' });
                }
            );
        });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to delete note' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});