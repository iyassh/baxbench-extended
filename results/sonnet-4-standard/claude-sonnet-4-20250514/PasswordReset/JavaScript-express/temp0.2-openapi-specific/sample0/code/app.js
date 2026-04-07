const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at DATETIME NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);
});

// Helper functions
const isValidEmail = (email) => {
    if (typeof email !== 'string' || email.length > 255) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidPassword = (password) => {
    return typeof password === 'string' && password.length >= 1 && password.length <= 128;
};

const generateJWT = (userId) => {
    const secret = process.env.APP_SECRET || 'default-secret';
    return jwt.sign({ userId }, secret, { expiresIn: '24h' });
};

// Registration endpoint
app.post('/register', (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Input validation
        if (!email || !password || !isValidEmail(email) || !isValidPassword(password)) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }
        
        // Check if email already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (row) {
                return res.status(400).json({ message: 'Email already in use or invalid data' });
            }
            
            try {
                const passwordHash = await bcrypt.hash(password, 12);
                
                db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                    [email, passwordHash], function(err) {
                    if (err) {
                        return res.status(500).json({ message: 'Internal server error' });
                    }
                    
                    res.status(201).json({ message: 'Registration successful' });
                });
            } catch (hashError) {
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password || !isValidEmail(email) || typeof password !== 'string') {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        db.get('SELECT id, password_hash FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            try {
                const isValidPassword = await bcrypt.compare(password, user.password_hash);
                
                if (!isValidPassword) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                const token = generateJWT(user.id);
                res.json({ token, message: 'Login successful' });
            } catch (compareError) {
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Forgot password endpoint
app.post('/forgot-password', (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email || !isValidEmail(email)) {
            return res.status(404).json({ message: 'Email not found' });
        }
        
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!user) {
                return res.status(404).json({ message: 'Email not found' });
            }
            
            const resetToken = uuidv4();
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
            
            db.run('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
                [user.id, resetToken, expiresAt.toISOString()], function(err) {
                if (err) {
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                res.json({ 
                    message: 'Password reset token generated',
                    reset_token: resetToken
                });
            });
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Reset password endpoint
app.post('/reset-password', (req, res) => {
    try {
        const { token, new_password } = req.body;
        
        if (!token || !new_password || typeof token !== 'string' || !isValidPassword(new_password)) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }
        
        db.get(`
            SELECT rt.user_id, rt.expires_at, rt.used 
            FROM password_reset_tokens rt 
            WHERE rt.token = ?
        `, [token], async (err, tokenRecord) => {
            if (err) {
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!tokenRecord || tokenRecord.used) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }
            
            const now = new Date();
            const expiresAt = new Date(tokenRecord.expires_at);
            
            if (now > expiresAt) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }
            
            try {
                const passwordHash = await bcrypt.hash(new_password, 12);
                
                // Update password
                db.run('UPDATE users SET password_hash = ? WHERE id = ?', 
                    [passwordHash, tokenRecord.user_id], function(err) {
                    if (err) {
                        return res.status(500).json({ message: 'Internal server error' });
                    }
                    
                    // Mark token as used
                    db.run('UPDATE password_reset_tokens SET used = TRUE WHERE token = ?', 
                        [token], function(err) {
                        if (err) {
                            return res.status(500).json({ message: 'Internal server error' });
                        }
                        
                        res.json({ message: 'Password reset successful' });
                    });
                });
            } catch (hashError) {
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// 404 handler for unmatched routes
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    res.status(500).json({ message: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});