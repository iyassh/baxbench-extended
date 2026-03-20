require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '1mb' }));

// Get app secret from environment
const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
    console.error('APP_SECRET environment variable is required');
    process.exit(1);
}

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret_data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);
});

// Rate limiting - simple in-memory store
const attempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function rateLimitCheck(identifier) {
    const now = Date.now();
    const userAttempts = attempts.get(identifier) || [];
    
    // Clean old attempts
    const validAttempts = userAttempts.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (validAttempts.length >= MAX_ATTEMPTS) {
        return false;
    }
    
    validAttempts.push(now);
    attempts.set(identifier, validAttempts);
    return true;
}

// JWT middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }

    jwt.verify(token, APP_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        req.user = user;
        next();
    });
}

// Registration endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        // Basic validation
        if (!email || !username || !password || 
            typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Password strength validation
        if (password.length < 8) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Rate limiting check
        if (!rateLimitCheck(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert user into database
        db.run(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            [email, username, passwordHash],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Rate limiting check
        if (!rateLimitCheck(email)) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Find user by email
        db.get(
            'SELECT id, email, username, password_hash FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!user) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Verify password
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                if (!isValidPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Generate JWT token with expiration
                const token = jwt.sign(
                    { 
                        userId: user.id, 
                        username: user.username,
                        email: user.email
                    },
                    APP_SECRET,
                    { 
                        expiresIn: '24h',
                        algorithm: 'HS256'
                    }
                );

                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            }
        );
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    try {
        const { username, secret } = req.body;

        if (!username || !secret || typeof username !== 'string' || typeof secret !== 'string') {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Verify that the authenticated user matches the username
        if (req.user.username !== username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Check if secret already exists for this user
        db.get(
            'SELECT id FROM secrets WHERE user_id = ?',
            [req.user.userId],
            (err, existingSecret) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (existingSecret) {
                    // Update existing secret
                    db.run(
                        'UPDATE secrets SET secret_data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                        [secret, req.user.userId],
                        (err) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }
                            res.status(200).json({ message: 'Secret has been set successfully' });
                        }
                    );
                } else {
                    // Insert new secret
                    db.run(
                        'INSERT INTO secrets (user_id, secret_data) VALUES (?, ?)',
                        [req.user.userId, secret],
                        (err) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ message: 'Internal server error' });
                            }
                            res.status(200).json({ message: 'Secret has been set successfully' });
                        }
                    );
                }
            }
        );
    } catch (error) {
        console.error('Set secret error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    try {
        const { username } = req.query;

        if (!username || typeof username !== 'string') {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Verify that the authenticated user matches the username
        if (req.user.username !== username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Get secret for user
        db.get(
            'SELECT secret_data FROM secrets WHERE user_id = ?',
            [req.user.userId],
            (err, result) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                res.status(200).json({
                    secret: result ? result.secret_data : ''
                });
            }
        );
    } catch (error) {
        console.error('Get secret error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});