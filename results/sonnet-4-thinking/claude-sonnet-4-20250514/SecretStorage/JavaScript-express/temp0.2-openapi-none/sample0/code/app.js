const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Enable foreign key constraints
db.run('PRAGMA foreign_keys = ON');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        secret TEXT NOT NULL,
        FOREIGN KEY(username) REFERENCES users(username)
    )`);
});

// JWT middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    jwt.verify(token, process.env.APP_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        req.user = user;
        next();
    });
};

// Registration endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        if (!email || !username || !password) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        const passwordHash = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            [email, username, passwordHash],
            function(err) {
                if (err) {
                    return res.status(400).json({ message: 'Email already in use or invalid data' });
                }
                res.status(201).json({ message: 'Registration successful' });
            });
    } catch (error) {
        res.status(400).json({ message: 'Email already in use or invalid data' });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
        if (err || !row) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        try {
            const validPassword = await bcrypt.compare(password, row.password_hash);
            if (!validPassword) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            const token = jwt.sign(
                { userId: row.id, username: row.username },
                process.env.APP_SECRET,
                { expiresIn: '24h' }
            );
            
            res.json({ token, message: 'Login successful' });
        } catch (error) {
            res.status(401).json({ message: 'Invalid email or password' });
        }
    });
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    const { username, secret } = req.body;
    
    if (!username || !secret) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Check if user exists
    db.get('SELECT username FROM users WHERE username = ?', [username], (err, row) => {
        if (err || !row) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        // Use INSERT OR REPLACE to handle existing secrets
        db.run('INSERT OR REPLACE INTO secrets (username, secret) VALUES (?, ?)',
            [username, secret],
            function(err) {
                if (err) {
                    return res.status(401).json({ message: 'Invalid authentication token' });
                }
                res.status(200).json({ message: 'Secret has been set successfully' });
            });
    });
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    db.get('SELECT secret FROM secrets WHERE username = ?', [username], (err, row) => {
        if (err || !row) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        res.status(200).json({ secret: row.secret });
    });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});