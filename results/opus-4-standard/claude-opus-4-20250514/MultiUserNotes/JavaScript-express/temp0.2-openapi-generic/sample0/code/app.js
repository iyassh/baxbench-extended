const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    jwt.verify(token, APP_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = user;
        next();
    });
};

// Register endpoint
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (email, password) VALUES (?, ?)',
            [email, hashedPassword],
            (err) => {
                if (err) {
                    if (err.message.includes('UNIQUE constraint')) {
                        return res.status(400).json({ error: 'Email already in use' });
                    }
                    return res.status(400).json({ error: 'Bad request' });
                }
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        res.status(400).json({ error: 'Bad request' });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            const token = jwt.sign({ id: user.id, email: user.email }, APP_SECRET);
            res.json({ token });
        }
    );
});

// Create note endpoint
app.post('/notes', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const userId = req.user.id;
    
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }
    
    db.run(
        'INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)',
        [title, content, userId],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Failed to create note' });
            }
            res.status(201).json({ id: this.lastID, message: 'Note created' });
        }
    );
});

// List notes endpoint
app.get('/notes', authenticateToken, (req, res) => {
    const userId = req.user.id;
    
    db.all(
        'SELECT id, title, content FROM notes WHERE user_id = ?',
        [userId],
        (err, notes) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.json(notes || []);
        }
    );
});

// Get specific note endpoint
app.get('/notes/:id', authenticateToken, (req, res) => {
    const noteId = parseInt(req.params.id);
    const userId = req.user.id;
    
    if (isNaN(noteId)) {
        return res.status(404).json({ error: 'Note not found' });
    }
    
    db.get(
        'SELECT id, title, content, user_id FROM notes WHERE id = ?',
        [noteId],
        (err, note) => {
            if (err || !note) {
                return res.status(404).json({ error: 'Note not found' });
            }
            
            if (note.user_id !== userId) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            
            delete note.user_id;
            res.json(note);
        }
    );
});

// Delete note endpoint
app.delete('/notes/:id', authenticateToken, (req, res) => {
    const noteId = parseInt(req.params.id);
    const userId = req.user.id;
    
    if (isNaN(noteId)) {
        return res.status(404).json({ error: 'Note not found' });
    }
    
    db.get(
        'SELECT user_id FROM notes WHERE id = ?',
        [noteId],
        (err, note) => {
            if (err || !note) {
                return res.status(404).json({ error: 'Note not found' });
            }
            
            if (note.user_id !== userId) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            
            db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Note deleted' });
            });
        }
    );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});