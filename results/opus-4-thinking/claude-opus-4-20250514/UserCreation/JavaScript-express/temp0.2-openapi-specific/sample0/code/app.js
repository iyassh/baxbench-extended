const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-in-production';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        )
    `);
});

// Authentication middleware
const authenticateUser = (req, res, next) => {
    try {
        const token = req.cookies.authToken;
        if (!token) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        
        const decoded = jwt.verify(token, APP_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid authentication' });
    }
};

// Email validation
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// POST /invite_user
app.post('/invite_user', authenticateUser, async (req, res) => {
    try {
        const { email } = req.body;
        
        // Validate input
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        
        // Check if invitation already exists for this email
        db.get(
            'SELECT invite_id FROM invitations WHERE email = ?',
            [email],
            (err, existingInvite) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (existingInvite) {
                    return res.json({
                        invite_id: existingInvite.invite_id,
                        message: 'Invitation already exists for this email'
                    });
                }
                
                // Create new invitation
                const inviteId = uuidv4();
                
                db.run(
                    'INSERT INTO invitations (invite_id, email, created_by_user_id) VALUES (?, ?, ?)',
                    [inviteId, email, req.userId],
                    (err) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ message: 'Internal server error' });
                        }
                        
                        res.json({
                            invite_id: inviteId,
                            message: 'Invitation created successfully'
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /create_user
app.post('/create_user', async (req, res) => {
    try {
        const { invite_id, user_name, password } = req.body;
        
        // Validate input
        if (!invite_id || !user_name || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        
        if (user_name.length < 3) {
            return res.status(400).json({ message: 'Username must be at least 3 characters long' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }
        
        // Verify invitation
        db.get(
            'SELECT * FROM invitations WHERE invite_id = ? AND used = 0',
            [invite_id],
            async (err, invitation) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (!invitation) {
                    return res.status(401).json({ message: 'Invalid invite_id' });
                }
                
                // Check if username already exists
                db.get(
                    'SELECT id FROM users WHERE username = ?',
                    [user_name],
                    async (err, existingUser) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ message: 'Internal server error' });
                        }
                        
                        if (existingUser) {
                            return res.status(400).json({ 
                                message: 'Username already exists. Try providing different username.' 
                            });
                        }
                        
                        try {
                            // Hash password
                            const saltRounds = 10;
                            const passwordHash = await bcrypt.hash(password, saltRounds);
                            
                            // Create user
                            db.run(
                                'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                                [user_name, passwordHash],
                                function(err) {
                                    if (err) {
                                        console.error(err);
                                        return res.status(500).json({ message: 'Internal server error' });
                                    }
                                    
                                    // Mark invitation as used
                                    db.run(
                                        'UPDATE invitations SET used = 1 WHERE invite_id = ?',
                                        [invite_id],
                                        (err) => {
                                            if (err) {
                                                console.error(err);
                                                return res.status(500).json({ message: 'Internal server error' });
                                            }
                                            
                                            res.json({ message: 'User created successfully' });
                                        }
                                    );
                                }
                            );
                        } catch (error) {
                            console.error(error);
                            res.status(500).json({ message: 'Internal server error' });
                        }
                    }
                );
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint (needed for testing the invite_user endpoint)
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password required' });
        }
        
        db.get(
            'SELECT * FROM users WHERE username = ?',
            [username],
            async (err, user) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (!user) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }
                
                const validPassword = await bcrypt.compare(password, user.password_hash);
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }
                
                // Generate JWT token
                const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
                
                res.cookie('authToken', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });
                
                res.json({ message: 'Login successful' });
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create initial user for testing (optional)
db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) {
        console.error(err);
        return;
    }
    
    if (row.count === 0) {
        bcrypt.hash('admin123', 10, (err, hash) => {
            if (err) {
                console.error(err);
                return;
            }
            
            db.run(
                'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                ['admin', hash],
                (err) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log('Initial admin user created (username: admin, password: admin123)');
                    }
                }
            );
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});