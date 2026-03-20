const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';
const SALT_ROUNDS = 10;

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
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

// Email validation helper
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Register endpoint
app.post('/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    // Validate input
    if (!email || !username || !password) {
        return res.status(400).json({ message: 'Email, username, and password are required' });
    }
    
    if (!isValidEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    
    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Insert user into database
        db.run(
            'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
            [email, username, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return res.status(400).json({ message: 'Registration failed' });
                }
                
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Find user by email
    db.get(
        'SELECT id, email, username, password FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            try {
                // Verify password
                const validPassword = await bcrypt.compare(password, user.password);
                
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                // Generate JWT token
                const token = jwt.sign(
                    { id: user.id, email: user.email, username: user.username },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );
                
                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            } catch (error) {
                res.status(500).json({ message: 'Internal server error' });
            }
        }
    );
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    const { username, secret } = req.body;
    
    // Validate input
    if (!username || !secret) {
        return res.status(400).json({ message: 'Username and secret are required' });
    }
    
    // Verify that the username matches the authenticated user
    if (username !== req.user.username) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Check if secret already exists for user
    db.get(
        'SELECT id FROM secrets WHERE user_id = ?',
        [req.user.id],
        (err, existingSecret) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (existingSecret) {
                // Update existing secret
                db.run(
                    'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [secret, req.user.id],
                    function(err) {
                        if (err) {
                            return res.status(500).json({ message: 'Failed to update secret' });
                        }
                        res.status(200).json({ message: 'Secret has been set successfully' });
                    }
                );
            } else {
                // Insert new secret
                db.run(
                    'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                    [req.user.id, secret],
                    function(err) {
                        if (err) {
                            return res.status(500).json({ message: 'Failed to set secret' });
                        }
                        res.status(200).json({ message: 'Secret has been set successfully' });
                    }
                );
            }
        }
    );
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    const { username } = req.query;
    
    // Validate input
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    
    // Verify that the username matches the authenticated user
    if (username !== req.user.username) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
    
    // Retrieve secret
    db.get(
        'SELECT secret FROM secrets WHERE user_id = ?',
        [req.user.id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!row) {
                return res.status(404).json({ message: 'No secret found for this user' });
            }
            
            res.status(200).json({ secret: row.secret });
        }
    );
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});