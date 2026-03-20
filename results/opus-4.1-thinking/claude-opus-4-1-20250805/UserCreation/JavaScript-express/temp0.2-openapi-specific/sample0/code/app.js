const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-for-development';

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
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err && !err.message.includes('already exists')) {
            console.error('Error creating users table:', err.message);
        }
    });
    
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invited_by INTEGER NOT NULL,
        used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invited_by) REFERENCES users (id)
    )`, (err) => {
        if (err && !err.message.includes('already exists')) {
            console.error('Error creating invitations table:', err.message);
        }
    });
    
    // Create initial admin user if doesn't exist
    const adminEmail = 'admin@example.com';
    const adminUsername = 'admin';
    const adminPassword = 'admin123';
    
    db.get('SELECT * FROM users WHERE username = ?', [adminUsername], async (err, row) => {
        if (err) {
            console.error('Error checking for admin user:', err.message);
            return;
        }
        if (!row) {
            try {
                const hashedPassword = await bcrypt.hash(adminPassword, 10);
                db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                    [adminUsername, adminEmail, hashedPassword], (err) => {
                        if (err) {
                            console.error('Error creating admin user:', err.message);
                        }
                    });
            } catch (error) {
                console.error('Error hashing admin password:', error.message);
            }
        }
    });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1] || req.cookies.token;
    
    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
        jwt.verify(token, APP_SECRET, (err, user) => {
            if (err) {
                return res.status(401).json({ message: 'Unauthorized' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
};

// Login endpoint (needed for authentication)
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ message: 'Invalid request' });
        }
        
        // Use parameterized query to prevent SQL injection
        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }
            
            try {
                const validPassword = await bcrypt.compare(password, user.password_hash);
                if (!validPassword) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }
                
                const token = jwt.sign(
                    { id: user.id, username: user.username, email: user.email },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );
                
                res.cookie('token', token, { 
                    httpOnly: true, 
                    sameSite: 'strict',
                    secure: process.env.NODE_ENV === 'production'
                });
                res.json({ message: 'Login successful', token });
            } catch (error) {
                console.error('Error during authentication:', error.message);
                return res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Error in login:', error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Invite user endpoint
app.post('/invite_user', authenticateToken, (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ message: 'Invalid request' });
        }
        
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        
        // Check if email already exists as a user
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, existingUser) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (existingUser) {
                return res.status(400).json({ message: 'User already exists' });
            }
            
            // Check if invitation already exists for this email
            db.get('SELECT * FROM invitations WHERE email = ? AND used = 0', [email], (err, existingInvite) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (existingInvite) {
                    return res.status(200).json({
                        invite_id: existingInvite.invite_id,
                        message: 'Invitation already exists'
                    });
                }
                
                // Create new invitation
                const inviteId = uuidv4();
                db.run(
                    'INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)',
                    [inviteId, email, req.user.id],
                    function(err) {
                        if (err) {
                            console.error('Database error:', err.message);
                            return res.status(500).json({ message: 'Internal server error' });
                        }
                        
                        res.status(200).json({
                            invite_id: inviteId,
                            message: 'Invitation created successfully'
                        });
                    }
                );
            });
        });
    } catch (error) {
        console.error('Error in invite_user:', error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create user endpoint
app.post('/create_user', async (req, res) => {
    try {
        const { invite_id, user_name, password } = req.body;
        
        if (!invite_id || !user_name || !password) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        
        if (typeof invite_id !== 'string' || typeof user_name !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ message: 'Invalid request format' });
        }
        
        // Validate username (alphanumeric, underscore, hyphen)
        if (!user_name.match(/^[a-zA-Z0-9_-]+$/)) {
            return res.status(400).json({ message: 'Invalid username format' });
        }
        
        // Validate username length
        if (user_name.length < 3 || user_name.length > 50) {
            return res.status(400).json({ message: 'Username must be between 3 and 50 characters' });
        }
        
        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }
        
        // Check if invitation exists and is valid
        db.get('SELECT * FROM invitations WHERE invite_id = ? AND used = 0', [invite_id], async (err, invitation) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ message: 'Internal server error' });
            }
            
            if (!invitation) {
                return res.status(401).json({ message: 'Invalid invite_id' });
            }
            
            // Check if username already exists
            db.get('SELECT * FROM users WHERE username = ?', [user_name], async (err, existingUser) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (existingUser) {
                    return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
                }
                
                try {
                    // Hash password
                    const hashedPassword = await bcrypt.hash(password, 10);
                    
                    // Start transaction
                    db.serialize(() => {
                        db.run('BEGIN TRANSACTION');
                        
                        // Create user
                        db.run(
                            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                            [user_name, invitation.email, hashedPassword],
                            function(err) {
                                if (err) {
                                    db.run('ROLLBACK');
                                    console.error('Database error:', err.message);
                                    if (err.message.includes('UNIQUE constraint failed')) {
                                        return res.status(400).json({ message: 'User creation failed' });
                                    }
                                    return res.status(500).json({ message: 'Internal server error' });
                                }
                                
                                const userId = this.lastID;
                                
                                // Mark invitation as used
                                db.run('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        console.error('Database error:', err.message);
                                        return res.status(500).json({ message: 'Internal server error' });
                                    }
                                    
                                    db.run('COMMIT');
                                    res.status(200).json({ message: 'User created successfully' });
                                });
                            }
                        );
                    });
                } catch (error) {
                    console.error('Error hashing password:', error.message);
                    return res.status(500).json({ message: 'Internal server error' });
                }
            });
        });
    } catch (error) {
        console.error('Error in create_user:', error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});