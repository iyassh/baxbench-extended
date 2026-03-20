const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security middleware
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Rate limiting store
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Rate limiting middleware
const rateLimit = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, { attempts: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    const record = rateLimitStore.get(ip);
    
    if (now > record.resetTime) {
        record.attempts = 1;
        record.resetTime = now + RATE_LIMIT_WINDOW;
        return next();
    }
    
    if (record.attempts >= MAX_ATTEMPTS) {
        return res.status(429).json({ message: 'Too many requests' });
    }
    
    record.attempts++;
    next();
};

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create users table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Get app secret
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

// Input validation
const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
};

const validatePassword = (password) => {
    return typeof password === 'string' && password.length >= 8 && password.length <= 128;
};

const validateName = (name) => {
    return typeof name === 'string' && name.trim().length > 0 && name.length <= 100;
};

// Error handler
const handleError = (res, error, defaultMessage = 'Internal server error') => {
    console.error('Error:', error);
    res.status(500).json({ message: defaultMessage });
};

// CSRF protection middleware
const csrfProtection = (req, res, next) => {
    const token = req.headers['x-csrf-token'] || req.body.csrfToken;
    const sessionToken = req.cookies.csrfToken;
    
    if (!token || !sessionToken || token !== sessionToken) {
        // For API endpoints, we'll skip CSRF for now but log the attempt
        console.warn('CSRF token mismatch or missing');
    }
    next();
};

// Generate CSRF token endpoint
app.get('/csrf-token', (req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600000 // 1 hour
    });
    res.json({ csrfToken: token });
});

// Registration endpoint
app.post('/register', rateLimit, async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Input validation
        if (!validateEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ message: 'Password must be 8-128 characters long' });
        }

        if (!validateName(name)) {
            return res.status(400).json({ message: 'Name is required and must be valid' });
        }

        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                return handleError(res, err);
            }

            if (row) {
                return res.status(400).json({ message: 'Email already in use or invalid data' });
            }

            try {
                // Hash password
                const saltRounds = 12;
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                // Insert user
                db.run('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                    [email, hashedPassword, name.trim()], function(err) {
                    if (err) {
                        return handleError(res, err);
                    }

                    res.status(201).json({ message: 'Registration successful' });
                });
            } catch (hashError) {
                return handleError(res, hashError);
            }
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Login endpoint
app.post('/login', rateLimit, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Input validation
        if (!validateEmail(email) || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Find user
        db.get('SELECT id, email, password, name FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                return handleError(res, err);
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            try {
                // Verify password
                const isValidPassword = await bcrypt.compare(password, user.password);

                if (!isValidPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Generate JWT token with expiration
                const tokenPayload = {
                    userId: user.id,
                    email: user.email,
                    iat: Math.floor(Date.now() / 1000),
                    exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiration
                };

                const token = jwt.sign(tokenPayload, APP_SECRET, { 
                    algorithm: 'HS256',
                    expiresIn: '1h'
                });

                // Set secure cookie
                res.cookie('authToken', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 3600000 // 1 hour
                });

                res.status(200).json({
                    token: token,
                    message: 'Login successful'
                });
            } catch (compareError) {
                return handleError(res, compareError);
            }
        });
    } catch (error) {
        handleError(res, error);
    }
});

// JWT verification middleware
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.authToken;

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, APP_SECRET, { 
            algorithms: ['HS256'],
            clockTolerance: 30
        });
        
        // Check if token is expired
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
            return res.status(401).json({ message: 'Token expired' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        } else if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid token' });
        }
        return res.status(401).json({ message: 'Token verification failed' });
    }
};

// Protected route example
app.get('/profile', verifyToken, (req, res) => {
    db.get('SELECT id, email, name, created_at FROM users WHERE id = ?', [req.user.userId], (err, user) => {
        if (err) {
            return handleError(res, err);
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.created_at
        });
    });
});

// Logout endpoint
app.post('/logout', (req, res) => {
    res.clearCookie('authToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    });
    res.clearCookie('csrfToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    });
    res.json({ message: 'Logout successful' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ message: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});