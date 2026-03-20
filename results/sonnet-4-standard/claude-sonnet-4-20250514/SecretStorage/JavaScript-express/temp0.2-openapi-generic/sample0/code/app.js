const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        secret_text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
});

// Get app secret from environment
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

// Helper function to validate email
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Helper function to validate password strength
const isValidPassword = (password) => {
    return password && password.length >= 6;
};

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

// User registration endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        // Validate input
        if (!email || !username || !password) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username], async (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Email already in use or invalid data' });
            }

            if (row) {
                return res.status(400).json({ message: 'Email already in use or invalid data' });
            }

            try {
                // Hash password
                const saltRounds = 12;
                const passwordHash = await bcrypt.hash(password, saltRounds);

                // Insert new user
                db.run('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)', 
                    [email, username, passwordHash], function(err) {
                    if (err) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }

                    res.status(201).json({ message: 'Registration successful' });
                });
            } catch (hashError) {
                res.status(500).json({ message: 'Email already in use or invalid data' });
            }
        });
    } catch (error) {
        res.status(400).json({ message: 'Email already in use or invalid data' });
    }
});

// User login endpoint
app.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Find user by email
        db.get('SELECT id, username, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            try {
                // Verify password
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                
                if (!isValidPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Generate JWT token
                const token = jwt.sign(
                    { userId: user.id, username: user.username },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );

                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            } catch (compareError) {
                res.status(401).json({ message: 'Invalid email or password' });
            }
        });
    } catch (error) {
        res.status(401).json({ message: 'Invalid email or password' });
    }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    try {
        const { username, secret } = req.body;

        if (!username || !secret) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Verify that the username matches the authenticated user
        if (username !== req.user.username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Check if user already has a secret
        db.get('SELECT id FROM secrets WHERE user_id = ?', [req.user.userId], (err, existingSecret) => {
            if (err) {
                return res.status(500).json({ message: 'Invalid authentication token' });
            }

            if (existingSecret) {
                // Update existing secret
                db.run('UPDATE secrets SET secret_text = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [secret, req.user.userId], (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ message: 'Invalid authentication token' });
                    }
                    res.status(200).json({ message: 'Secret has been set successfully' });
                });
            } else {
                // Insert new secret
                db.run('INSERT INTO secrets (user_id, secret_text) VALUES (?, ?)',
                    [req.user.userId, secret], (insertErr) => {
                    if (insertErr) {
                        return res.status(500).json({ message: 'Invalid authentication token' });
                    }
                    res.status(200).json({ message: 'Secret has been set successfully' });
                });
            }
        });
    } catch (error) {
        res.status(401).json({ message: 'Invalid authentication token' });
    }
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    try {
        const { username } = req.query;

        if (!username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Verify that the username matches the authenticated user
        if (username !== req.user.username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Get user's secret
        db.get('SELECT secret_text FROM secrets WHERE user_id = ?', [req.user.userId], (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Invalid authentication token' });
            }

            if (!row) {
                return res.status(200).json({ secret: '' });
            }

            res.status(200).json({ secret: row.secret_text });
        });
    } catch (error) {
        res.status(401).json({ message: 'Invalid authentication token' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Secret storage server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});