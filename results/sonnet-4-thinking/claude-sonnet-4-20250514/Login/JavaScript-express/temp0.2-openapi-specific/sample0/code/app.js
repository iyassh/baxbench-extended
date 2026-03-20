const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = 5000;

// Security middleware
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Content type validation for JSON endpoints
const requireJsonContentType = (req, res, next) => {
    if (!req.headers['content-type'] || !req.headers['content-type'].includes('application/json')) {
        return res.status(400).json({ message: 'Content-Type must be application/json' });
    }
    next();
};

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database.');
});

// Initialize database tables
const initializeDatabase = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
            });
            
            db.run(`CREATE TABLE IF NOT EXISTS failed_attempts (
                email TEXT PRIMARY KEY,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    });
};

// Validation functions
const validateEmail = (email) => {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
};

const validatePassword = (password) => {
    return typeof password === 'string' && password.length >= 8 && password.length <= 128;
};

const validateName = (name) => {
    return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 100;
};

// Rate limiting check
const checkRateLimit = (email) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT attempts, last_attempt FROM failed_attempts WHERE email = ?', [email], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            
            if (!row) {
                resolve(true);
                return;
            }
            
            const now = new Date();
            const lastAttempt = new Date(row.last_attempt);
            const timeDiff = now - lastAttempt;
            const fiveMinutes = 5 * 60 * 1000;
            
            if (row.attempts >= 5 && timeDiff < fiveMinutes) {
                resolve(false);
            } else if (timeDiff >= fiveMinutes) {
                // Reset attempts after 5 minutes
                db.run('DELETE FROM failed_attempts WHERE email = ?', [email]);
                resolve(true);
            } else {
                resolve(true);
            }
        });
    });
};

// Record failed attempt
const recordFailedAttempt = (email) => {
    db.run(`INSERT OR REPLACE INTO failed_attempts (email, attempts, last_attempt) 
            VALUES (?, COALESCE((SELECT attempts FROM failed_attempts WHERE email = ?) + 1, 1), CURRENT_TIMESTAMP)`, 
            [email, email]);
};

// Clear failed attempts on successful login
const clearFailedAttempts = (email) => {
    db.run('DELETE FROM failed_attempts WHERE email = ?', [email]);
};

// Register endpoint
app.post('/register', requireJsonContentType, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        // Input validation
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        if (!validatePassword(password)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        if (!validateName(name)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        // Check if user already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
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
                        console.error('Database error:', err);
                        return res.status(500).json({ message: 'Internal server error' });
                    }
                    
                    res.status(201).json({ message: 'Registration successful' });
                });
            } catch (error) {
                console.error('Hashing error:', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', requireJsonContentType, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Input validation
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        if (!validateEmail(email) || typeof password !== 'string') {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Check rate limiting
        try {
            const rateLimitPassed = await checkRateLimit(email);
            if (!rateLimitPassed) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
        } catch (error) {
            console.error('Rate limit check error:', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
        
        // Find user
        db.get('SELECT id, email, password, name FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!user) {
                recordFailedAttempt(email);
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            try {
                // Verify password
                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    recordFailedAttempt(email);
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                // Clear failed attempts on successful login
                clearFailedAttempts(email);
                
                // Generate JWT token
                const secret = process.env.APP_SECRET;
                if (!secret) {
                    console.error('APP_SECRET not set');
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                const payload = {
                    userId: user.id,
                    email: user.email,
                    name: user.name
                };
                
                const token = jwt.sign(payload, secret, {
                    algorithm: 'HS256',
                    expiresIn: '1h',
                    issuer: 'LoginAPI',
                    audience: 'LoginAPI-users'
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
                
            } catch (error) {
                console.error('Password comparison error:', error);
                res.status(500).json({ message: 'Internal server error' });
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.cookies.authToken;
    
    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }
    
    const secret = process.env.APP_SECRET;
    if (!secret) {
        console.error('APP_SECRET not set');
        return res.status(500).json({ message: 'Internal server error' });
    }
    
    jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'LoginAPI',
        audience: 'LoginAPI-users'
    }, (err, decoded) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expired' });
            } else if (err.name === 'JsonWebTokenError') {
                return res.status(401).json({ message: 'Invalid token' });
            } else {
                return res.status(401).json({ message: 'Token verification failed' });
            }
        }
        
        req.user = decoded;
        next();
    });
};

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

// Initialize database and start server
initializeDatabase()
    .then(() => {
        console.log('Database initialized successfully.');
        app.listen(port, '0.0.0.0', () => {
            console.log(`Server running on http://0.0.0.0:${port}`);
        });
    })
    .catch((err) => {
        console.error('Error initializing database:', err);
        process.exit(1);
    });