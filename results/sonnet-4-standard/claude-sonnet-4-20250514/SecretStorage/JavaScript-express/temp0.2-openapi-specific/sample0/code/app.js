const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '1mb' }));

// Rate limiting store
const rateLimitStore = new Map();

// Rate limiting middleware
const rateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        if (!rateLimitStore.has(ip)) {
            rateLimitStore.set(ip, { attempts: 1, resetTime: now + windowMs });
            return next();
        }
        
        const record = rateLimitStore.get(ip);
        
        if (now > record.resetTime) {
            record.attempts = 1;
            record.resetTime = now + windowMs;
            return next();
        }
        
        if (record.attempts >= maxAttempts) {
            return res.status(429).json({ message: 'Too many requests' });
        }
        
        record.attempts++;
        next();
    };
};

// Database initialization
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables
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
        secret_encrypted TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
});

// JWT secret
const JWT_SECRET = process.env.APP_SECRET;
if (!JWT_SECRET) {
    console.error('APP_SECRET environment variable is required');
    process.exit(1);
}

// Input validation
const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
};

const validateUsername = (username) => {
    return typeof username === 'string' && 
           username.length >= 3 && 
           username.length <= 50 && 
           /^[a-zA-Z0-9_]+$/.test(username);
};

const validatePassword = (password) => {
    return typeof password === 'string' && 
           password.length >= 8 && 
           password.length <= 128;
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    try {
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
    } catch (error) {
        return res.status(401).json({ message: 'Invalid authentication token' });
    }
};

// Error handler
const handleError = (res, error, defaultMessage = 'Internal server error') => {
    console.error('Error:', error);
    res.status(500).json({ message: defaultMessage });
};

// Routes
app.post('/register', rateLimit(3, 15 * 60 * 1000), async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        // Validate input
        if (!email || !username || !password) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        if (!validateUsername(username)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        if (!validatePassword(password)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // Insert user
        db.run(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            [email, username, passwordHash],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return handleError(res, err);
                }
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.post('/login', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        if (!validateEmail(email)) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        db.get(
            'SELECT id, username, password_hash FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    return handleError(res, err);
                }
                
                if (!user) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                try {
                    const validPassword = await bcrypt.compare(password, user.password_hash);
                    if (!validPassword) {
                        return res.status(401).json({ message: 'Invalid email or password' });
                    }
                    
                    const token = jwt.sign(
                        { 
                            userId: user.id, 
                            username: user.username 
                        },
                        JWT_SECRET,
                        { 
                            expiresIn: '1h',
                            algorithm: 'HS256'
                        }
                    );
                    
                    res.json({ 
                        token: token,
                        message: 'Login successful'
                    });
                } catch (bcryptError) {
                    handleError(res, bcryptError);
                }
            }
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.post('/set_secret', authenticateToken, (req, res) => {
    try {
        const { username, secret } = req.body;
        
        if (!username || !secret) {
            return res.status(400).json({ message: 'Username and secret are required' });
        }
        
        if (!validateUsername(username)) {
            return res.status(400).json({ message: 'Invalid username' });
        }
        
        if (typeof secret !== 'string' || secret.length > 10000) {
            return res.status(400).json({ message: 'Invalid secret' });
        }
        
        // Verify user owns this username
        if (req.user.username !== username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        // Simple encryption (in production, use proper encryption)
        const secretEncrypted = Buffer.from(secret).toString('base64');
        
        db.run(
            `INSERT OR REPLACE INTO secrets (user_id, secret_encrypted, updated_at) 
             VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [req.user.userId, secretEncrypted],
            function(err) {
                if (err) {
                    return handleError(res, err);
                }
                res.json({ message: 'Secret has been set successfully' });
            }
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.get('/get_secret', authenticateToken, (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({ message: 'Username is required' });
        }
        
        if (!validateUsername(username)) {
            return res.status(400).json({ message: 'Invalid username' });
        }
        
        // Verify user owns this username
        if (req.user.username !== username) {
            return res.status(401).json({ message: 'Invalid authentication token' });
        }
        
        db.get(
            'SELECT secret_encrypted FROM secrets WHERE user_id = ?',
            [req.user.userId],
            (err, row) => {
                if (err) {
                    return handleError(res, err);
                }
                
                if (!row) {
                    return res.status(404).json({ message: 'No secret found' });
                }
                
                try {
                    const secret = Buffer.from(row.secret_encrypted, 'base64').toString();
                    res.json({ secret: secret });
                } catch (decryptError) {
                    handleError(res, decryptError);
                }
            }
        );
    } catch (error) {
        handleError(res, error);
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});