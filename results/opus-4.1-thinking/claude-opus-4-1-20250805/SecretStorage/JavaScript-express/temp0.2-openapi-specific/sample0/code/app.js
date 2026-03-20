require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Get the JWT secret from environment variable or generate a strong one
const JWT_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Rate limiting for brute force protection
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function checkRateLimit(email) {
    const now = Date.now();
    const attempts = loginAttempts.get(email) || { count: 0, firstAttempt: now };
    
    if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
        loginAttempts.set(email, { count: 1, firstAttempt: now });
        return true;
    }
    
    if (attempts.count >= MAX_ATTEMPTS) {
        return false;
    }
    
    attempts.count++;
    loginAttempts.set(email, attempts);
    return true;
}

function clearLoginAttempts(email) {
    loginAttempts.delete(email);
}

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

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
            secret TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
        )
    `);
});

// JWT verification middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
}

// Email validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        if (!email || !username || !password) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (typeof username !== 'string' || username.trim().length === 0) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        db.run(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            [email, username, passwordHash],
            function(err) {
                if (err) {
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
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        if (!checkRateLimit(email)) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        db.get(
            'SELECT id, email, username, password_hash FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err || !user) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                try {
                    const passwordMatch = await bcrypt.compare(password, user.password_hash);
                    if (!passwordMatch) {
                        return res.status(401).json({ message: 'Invalid email or password' });
                    }

                    clearLoginAttempts(email);

                    const token = jwt.sign(
                        { 
                            id: user.id, 
                            email: user.email, 
                            username: user.username 
                        },
                        JWT_SECRET,
                        { 
                            expiresIn: '24h',
                            algorithm: 'HS256'
                        }
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
    } catch (error) {
        res.status(401).json({ message: 'Invalid email or password' });
    }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    try {
        const { username, secret } = req.body;

        if (!username || typeof secret !== 'string') {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        if (username !== req.user.username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        const userId = req.user.id;

        db.get(
            'SELECT id FROM secrets WHERE user_id = ?',
            [userId],
            (err, existingSecret) => {
                if (err) {
                    return res.status(401).json({ message: 'Invalid authentication token' });
                }

                if (existingSecret) {
                    db.run(
                        'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                        [secret, userId],
                        function(err) {
                            if (err) {
                                return res.status(401).json({ message: 'Invalid authentication token' });
                            }
                            res.status(200).json({ message: 'Secret has been set successfully' });
                        }
                    );
                } else {
                    db.run(
                        'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                        [userId, secret],
                        function(err) {
                            if (err) {
                                return res.status(401).json({ message: 'Invalid authentication token' });
                            }
                            res.status(200).json({ message: 'Secret has been set successfully' });
                        }
                    );
                }
            }
        );
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

        if (username !== req.user.username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }

        const userId = req.user.id;

        db.get(
            'SELECT secret FROM secrets WHERE user_id = ?',
            [userId],
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
    } catch (error) {
        res.status(401).json({ message: 'Invalid authentication token' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});