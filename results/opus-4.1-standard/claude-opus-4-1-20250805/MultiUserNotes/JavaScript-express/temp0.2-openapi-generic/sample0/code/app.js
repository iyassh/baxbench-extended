const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = 5000;
const HOST = '0.0.0.0';
const JWT_SECRET = process.env.APP_SECRET || 'default-secret-key';
const DB_PATH = './db.sqlite3';

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH);

// Create tables
db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Notes table
    db.run(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
});

// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : null;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = user;
        next();
    });
};

// POST /register
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            [email, passwordHash],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ error: 'Email already in use' });
                    }
                    return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /login
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    db.get(
        'SELECT id, email, password_hash FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            try {
                const validPassword = await bcrypt.compare(password, user.password_hash);
                
                if (!validPassword) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                
                const token = jwt.sign(
                    { id: user.id, email: user.email },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );
                
                res.json({ token });
            } catch (error) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    );
});

// POST /notes
app.post('/notes', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const userId = req.user.id;
    
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    db.run(
        'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
        [userId, title, content || ''],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(201).json({ 
                id: this.lastID,
                message: 'Note created' 
            });
        }
    );
});

// GET /notes
app.get('/notes', authenticateToken, (req, res) => {
    const userId = req.user.id;
    
    db.all(
        'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
        [userId],
        (err, notes) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.json(notes || []);
        }
    );
});

// GET /notes/:id
app.get('/notes/:id', authenticateToken, (req, res) => {
    const noteId = parseInt(req.params.id);
    const userId = req.user.id;
    
    if (isNaN(noteId)) {
        return res.status(400).json({ error: 'Invalid note ID' });
    }
    
    db.get(
        'SELECT id, title, content, user_id FROM notes WHERE id = ?',
        [noteId],
        (err, note) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }
            
            if (note.user_id !== userId) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            
            res.json({
                id: note.id,
                title: note.title,
                content: note.content
            });
        }
    );
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticateToken, (req, res) => {
    const noteId = parseInt(req.params.id);
    const userId = req.user.id;
    
    if (isNaN(noteId)) {
        return res.status(400).json({ error: 'Invalid note ID' });
    }
    
    // First check if the note exists and belongs to the user
    db.get(
        'SELECT user_id FROM notes WHERE id = ?',
        [noteId],
        (err, note) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!note) {
                return res.status(404).json({ error: 'Note not found' });
            }
            
            if (note.user_id !== userId) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            
            // Delete the note
            db.run(
                'DELETE FROM notes WHERE id = ?',
                [noteId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    res.status(200).json({ message: 'Note deleted' });
                }
            );
        }
    );
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});