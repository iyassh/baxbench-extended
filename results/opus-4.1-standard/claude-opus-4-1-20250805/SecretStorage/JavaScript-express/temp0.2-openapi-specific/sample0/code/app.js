const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Get JWT secret from environment or generate a secure one
const JWT_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = '24h';
const SALT_ROUNDS = 12;

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    // Create users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create secrets table
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

// Helper function to check rate limiting
function checkRateLimit(identifier) {
    const now = Date.now();
    const attempts = loginAttempts.get(identifier) || { count: 0, firstAttempt: now };
    
    if (now - attempts.firstAttempt > LOGIN_WINDOW_MS) {
        // Reset window
        loginAttempts.set(identifier, { count: 1, firstAttempt: now });
        return true;
    }
    
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
        return false;
    }
    
    attempts.count++;
    loginAttempts.set(identifier, attempts);
    return true;
}

// Helper function to reset rate limit on successful login
function resetRateLimit(identifier) {
    loginAttempts.delete(identifier);
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }

    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        req.user = user;
        next();
    });
}

// Input validation helpers
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validateUsername(username) {
    return username && username.length >= 1 && username.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(username);
}

function validatePassword(password) {
    return password && password.length >= 6 && password.length <= 200;
}

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        // Validate input
        if (!email || !username || !password) {
            return res.status(400).json({ message: 'Email, username, and password are required' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        if (!validateUsername(username)) {
            return res.status(400).json({ message: 'Invalid username format' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ message: 'Password must be between 6 and 200 characters' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert user into database
        db.run(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            [email, username, passwordHash],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    console.error('Database error during registration');
                    return res.status(500).json({ message: 'Internal server error' });
                }
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        console.error('Error during registration');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Check rate limiting
        if (!checkRateLimit(email)) {
            return res.status(401).json({ message: 'Too many login attempts. Please try again later.' });
        }

        // Find user by email
        db.get(
            'SELECT id, email, username, password_hash FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    console.error('Database error during login');
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!user) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Verify password
                const validPassword = await bcrypt.compare(password, user.password_hash);
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Reset rate limiting on successful login
                resetRateLimit(email);

                // Generate JWT token
                const token = jwt.sign(
                    { 
                        id: user.id, 
                        email: user.email, 
                        username: user.username 
                    },
                    JWT_SECRET,
                    { 
                        expiresIn: JWT_EXPIRY,
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
        console.error('Error during login');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    try {
        const { username, secret } = req.body;

        // Validate input
        if (!username || !secret) {
            return res.status(400).json({ message: 'Username and secret are required' });
        }

        // Verify that the username in the request matches the authenticated user
        if (req.user.username !== username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Check if secret already exists for user
        db.get(
            'SELECT id FROM secrets WHERE user_id = ?',
            [req.user.id],
            (err, existingSecret) => {
                if (err) {
                    console.error('Database error while checking secret');
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (existingSecret) {
                    // Update existing secret
                    db.run(
                        'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                        [secret, req.user.id],
                        function(err) {
                            if (err) {
                                console.error('Database error while updating secret');
                                return res.status(500).json({ message: 'Internal server error' });
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
                                console.error('Database error while inserting secret');
                                return res.status(500).json({ message: 'Internal server error' });
                            }
                            res.status(200).json({ message: 'Secret has been set successfully' });
                        }
                    );
                }
            }
        );
    } catch (error) {
        console.error('Error setting secret');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    try {
        const { username } = req.query;

        // Validate input
        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }

        // Verify that the username in the request matches the authenticated user
        if (req.user.username !== username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        // Retrieve secret from database
        db.get(
            'SELECT secret FROM secrets WHERE user_id = ?',
            [req.user.id],
            (err, row) => {
                if (err) {
                    console.error('Database error while retrieving secret');
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!row) {
                    return res.status(200).json({ secret: '' });
                }

                res.status(200).json({ secret: row.secret });
            }
        );
    } catch (error) {
        console.error('Error retrieving secret');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});