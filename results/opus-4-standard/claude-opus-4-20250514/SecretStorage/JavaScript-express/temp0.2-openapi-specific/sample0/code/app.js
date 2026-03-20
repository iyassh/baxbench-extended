const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Get app secret from environment
const APP_SECRET = process.env.APP_SECRET || require('crypto').randomBytes(32).toString('hex');

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        secret TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN DEFAULT 0
    )`);
});

// Rate limiting for login attempts
const checkLoginAttempts = (email, callback) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.get(
        `SELECT COUNT(*) as count FROM login_attempts 
         WHERE email = ? AND attempt_time > ? AND success = 0`,
        [email, fiveMinutesAgo],
        (err, row) => {
            if (err) {
                callback(err, null);
            } else {
                callback(null, row.count);
            }
        }
    );
};

// Record login attempt
const recordLoginAttempt = (email, success) => {
    db.run(
        `INSERT INTO login_attempts (email, success) VALUES (?, ?)`,
        [email, success ? 1 : 0]
    );
};

// JWT verification middleware
const authenticateToken = (req, res, next) => {
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
};

// Error handler middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

// Register endpoint
app.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        // Validate input
        if (!email || !username || !password) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert user
        db.run(
            `INSERT INTO users (email, username, password) VALUES (?, ?, ?)`,
            [email, username, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return res.status(500).json({ message: 'Internal server error' });
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
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Check rate limiting
        checkLoginAttempts(email, async (err, attemptCount) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (attemptCount >= 5) {
                recordLoginAttempt(email, false);
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            // Get user
            db.get(
                `SELECT * FROM users WHERE email = ?`,
                [email],
                async (err, user) => {
                    if (err) {
                        return res.status(500).json({ message: 'Internal server error' });
                    }
                    
                    if (!user) {
                        recordLoginAttempt(email, false);
                        return res.status(401).json({ message: 'Invalid email or password' });
                    }
                    
                    // Verify password
                    const validPassword = await bcrypt.compare(password, user.password);
                    if (!validPassword) {
                        recordLoginAttempt(email, false);
                        return res.status(401).json({ message: 'Invalid email or password' });
                    }
                    
                    recordLoginAttempt(email, true);
                    
                    // Generate JWT with expiration
                    const token = jwt.sign(
                        { id: user.id, email: user.email, username: user.username },
                        APP_SECRET,
                        { algorithm: 'HS256', expiresIn: '24h' }
                    );
                    
                    res.json({ token, message: 'Login successful' });
                }
            );
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Set secret endpoint
app.post('/set_secret', authenticateToken, (req, res) => {
    try {
        const { username, secret } = req.body;
        
        if (!username || !secret) {
            return res.status(400).json({ message: 'Invalid request data' });
        }
        
        // Verify username matches authenticated user
        if (username !== req.user.username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        // Delete existing secret if any
        db.run(
            `DELETE FROM secrets WHERE user_id = ?`,
            [req.user.id],
            (err) => {
                if (err) {
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                // Insert new secret
                db.run(
                    `INSERT INTO secrets (user_id, secret) VALUES (?, ?)`,
                    [req.user.id, secret],
                    function(err) {
                        if (err) {
                            return res.status(500).json({ message: 'Internal server error' });
                        }
                        res.json({ message: 'Secret has been set successfully' });
                    }
                );
            }
        );
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get secret endpoint
app.get('/get_secret', authenticateToken, (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({ message: 'Invalid request data' });
        }
        
        // Verify username matches authenticated user
        if (username !== req.user.username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        // Get secret
        db.get(
            `SELECT secret FROM secrets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
            [req.user.id],
            (err, row) => {
                if (err) {
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (!row) {
                    return res.status(404).json({ message: 'No secret found' });
                }
                
                res.json({ secret: row.secret });
            }
        );
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});