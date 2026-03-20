const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;
const DB_PATH = './db.sqlite3';
const JWT_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const SALT_ROUNDS = 10;

// Rate limiting storage
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// CSRF tokens storage
const csrfTokens = new Map();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database.');
});

// Create users table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Error creating users table:', err.message);
        process.exit(1);
    }
});

// Rate limiting check
function checkRateLimit(email) {
    const now = Date.now();
    const userAttempts = loginAttempts.get(email) || { count: 0, firstAttempt: now };
    
    // Reset if window has passed
    if (now - userAttempts.firstAttempt > LOGIN_WINDOW_MS) {
        loginAttempts.delete(email);
        return true;
    }
    
    if (userAttempts.count >= MAX_LOGIN_ATTEMPTS) {
        return false;
    }
    
    return true;
}

// Record login attempt
function recordLoginAttempt(email) {
    const now = Date.now();
    const userAttempts = loginAttempts.get(email) || { count: 0, firstAttempt: now };
    userAttempts.count++;
    loginAttempts.set(email, userAttempts);
}

// Clear login attempts for successful login
function clearLoginAttempts(email) {
    loginAttempts.delete(email);
}

// Generate CSRF token
function generateCSRFToken() {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(token, Date.now());
    // Clean old tokens
    setTimeout(() => {
        csrfTokens.delete(token);
    }, 3600000); // 1 hour
    return token;
}

// Validate CSRF token
function validateCSRFToken(token) {
    if (!token || !csrfTokens.has(token)) {
        return false;
    }
    const tokenTime = csrfTokens.get(token);
    const now = Date.now();
    if (now - tokenTime > 3600000) { // 1 hour expiry
        csrfTokens.delete(token);
        return false;
    }
    csrfTokens.delete(token); // One-time use
    return true;
}

// CSRF middleware for state-changing operations
function csrfProtection(req, res, next) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const csrfToken = req.headers['x-csrf-token'] || req.body._csrf;
        if (!validateCSRFToken(csrfToken)) {
            return res.status(403).json({ message: 'Invalid CSRF token' });
        }
    }
    next();
}

// Error handler middleware
function errorHandler(err, req, res, next) {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal server error' });
}

// GET /csrf-token endpoint
app.get('/csrf-token', (req, res) => {
    const token = generateCSRFToken();
    res.json({ csrfToken: token });
});

// POST /register
app.post('/register', async (req, res, next) => {
    try {
        const { email, password, name } = req.body;
        
        // Validate input
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email, password, and name are required' });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        
        // Validate password strength (minimum 8 characters)
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Insert user into database
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return next(err);
                }
                
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (err) {
        next(err);
    }
});

// POST /login
app.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Check rate limit
        if (!checkRateLimit(email)) {
            return res.status(401).json({ message: 'Too many login attempts. Please try again later.' });
        }
        
        // Find user in database
        db.get(
            'SELECT * FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    return next(err);
                }
                
                if (!user) {
                    recordLoginAttempt(email);
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                // Verify password
                const validPassword = await bcrypt.compare(password, user.password);
                if (!validPassword) {
                    recordLoginAttempt(email);
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                // Clear login attempts on successful login
                clearLoginAttempts(email);
                
                // Generate JWT token with proper claims
                const token = jwt.sign(
                    { 
                        id: user.id, 
                        email: user.email,
                        iat: Math.floor(Date.now() / 1000)
                    },
                    JWT_SECRET,
                    { 
                        expiresIn: '24h',
                        algorithm: 'HS256'
                    }
                );
                
                // Set secure cookie
                res.cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });
                
                res.status(200).json({ 
                    token: token,
                    message: 'Login successful' 
                });
            }
        );
    } catch (err) {
        next(err);
    }
});

// Verify JWT middleware
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.cookies.token;
    
    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
        // Verify token with algorithm restriction
        const decoded = jwt.verify(token, JWT_SECRET, { 
            algorithms: ['HS256'],
            complete: true 
        });
        
        // Check if algorithm is not 'none'
        if (decoded.header.alg === 'none') {
            return res.status(401).json({ message: 'Invalid token' });
        }
        
        req.user = decoded.payload;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        return res.status(401).json({ message: 'Invalid token' });
    }
}

// Apply CSRF protection to state-changing endpoints when appropriate
app.use('/api/*', csrfProtection);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    server.close(() => {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            } else {
                console.log('Database connection closed.');
            }
            process.exit(0);
        });
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});