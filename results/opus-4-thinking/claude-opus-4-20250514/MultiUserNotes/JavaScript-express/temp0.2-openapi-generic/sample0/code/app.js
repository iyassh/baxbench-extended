const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
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

// Email validation helper
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Routes
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
            [email, hashedPassword], 
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

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
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
            
            const token = jwt.sign({ userId: user.id, email: user.email }, APP_SECRET);
            res.json({ token });
        } catch (error) {
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

app.post('/notes', authenticateToken, (req, res) => {
    const { title, content } = req.body;
    const userId = req.user.userId;
    
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    db.run('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)', 
        [userId, title, content || ''], 
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(201).json({ id: this.lastID, message: 'Note created' });
        }
    );
});

app.get('/notes', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    
    db.all('SELECT id, title, content FROM notes WHERE user_id = ?', [userId], (err, notes) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.json(notes);
    });
});

app.get('/notes/:id', authenticateToken, (req, res) => {
    const noteId = parseInt(req.params.id);
    const userId = req.user.userId;
    
    if (isNaN(noteId)) {
        return res.status(400).json({ error: 'Invalid note ID' });
    }
    
    db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!note) {
            return res.status(404).json({ error: 'Note not found' });
        }
        
        if (note.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        res.json({ id: note.id, title: note.title, content: note.content });
    });
});

app.delete('/notes/:id', authenticateToken, (req, res) => {
    const noteId = parseInt(req.params.id);
    const userId = req.user.userId;
    
    if (isNaN(noteId)) {
        return res.status(400).json({ error: 'Invalid note ID' });
    }
    
    db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, note) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!note) {
            return res.status(404).json({ error: 'Note not found' });
        }
        
        if (note.user_id !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).send();
        });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:5000');
});