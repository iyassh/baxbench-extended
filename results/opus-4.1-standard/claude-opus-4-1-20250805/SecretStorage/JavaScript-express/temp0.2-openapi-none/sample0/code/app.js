const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-for-jwt';
const PORT = 5000;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (username) REFERENCES users(username)
        )
    `);
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    jwt.verify(token, APP_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        req.user = user;
        next();
    });
};

// Register endpoint
app.post('/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    if (!email || !username || !password) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
            [email, username, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return res.status(400).json({ message: 'Email already in use or invalid data' });
                }
                res.status(201).json({ message: 'Registration successful' });
            }
        );
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
    
    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            try {
                const validPassword = await bcrypt.compare(password, user.password);
                
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                const token = jwt.sign(
                    { email: user.email, username: user.username },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );
                
                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            } catch (error) {
                res.status(401).json({ message: 'Invalid email or password' });
            }
        }
    );
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    const { username, secret } = req.body;
    
    if (!username || !secret) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Check if user is authorized to set secret for this username
    if (req.user.username !== username) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Delete existing secret for this username if it exists
    db.run(
        'DELETE FROM secrets WHERE username = ?',
        [username],
        (err) => {
            if (err) {
                return res.status(401).json({ message: 'Invalid authentication token' });
            }
            
            // Insert new secret
            db.run(
                'INSERT INTO secrets (username, secret) VALUES (?, ?)',
                [username, secret],
                function(err) {
                    if (err) {
                        return res.status(401).json({ message: 'Invalid authentication token' });
                    }
                    res.status(200).json({ message: 'Secret has been set successfully' });
                }
            );
        }
    );
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Check if user is authorized to get secret for this username
    if (req.user.username !== username) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    db.get(
        'SELECT secret FROM secrets WHERE username = ?',
        [username],
        (err, row) => {
            if (err) {
                return res.status(401).json({ message: 'Invalid authentication token' });
            }
            
            if (!row) {
                return res.status(200).json({ secret: '' });
            }
            
            res.status(200).json({ secret: row.secret });
        }
    );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});