const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.json());
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

const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-in-production';
const SALT_ROUNDS = 10;

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    // Create users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create invitations table
    db.run(`CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invited_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT 0,
        FOREIGN KEY (invited_by) REFERENCES users(id)
    )`);

    // Create initial admin user if not exists
    const adminEmail = 'admin@example.com';
    const adminUsername = 'admin';
    const adminPassword = 'admin123';
    
    bcrypt.hash(adminPassword, SALT_ROUNDS, (err, hash) => {
        if (err) return;
        db.run(
            `INSERT OR IGNORE INTO users (username, password_hash, email) VALUES (?, ?, ?)`,
            [adminUsername, hash, adminEmail],
            (err) => {
                if (err) console.error('Error creating admin user:', err.message);
            }
        );
    });
});

// Authentication middleware
const authenticateUser = (req, res, next) => {
    try {
        const token = req.cookies.auth_token;
        
        if (!token) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        jwt.verify(token, APP_SECRET, (err, decoded) => {
            if (err) {
                return res.status(401).json({ message: 'Invalid or expired token' });
            }
            req.userId = decoded.userId;
            next();
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
};

// Login endpoint (needed for authentication)
app.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password required' });
        }

        db.get(
            `SELECT id, password_hash FROM users WHERE username = ?`,
            [username],
            (err, user) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!user) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }

                bcrypt.compare(password, user.password_hash, (err, result) => {
                    if (err) {
                        console.error('Bcrypt error:', err.message);
                        return res.status(500).json({ message: 'Internal server error' });
                    }

                    if (!result) {
                        return res.status(401).json({ message: 'Invalid credentials' });
                    }

                    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
                    res.cookie('auth_token', token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict',
                        maxAge: 24 * 60 * 60 * 1000
                    });

                    res.json({ message: 'Login successful' });
                });
            }
        );
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Invite user endpoint
app.post('/invite_user', authenticateUser, (req, res) => {
    try {
        const { email } = req.body;
        const invitedBy = req.userId;

        if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return res.status(400).json({ message: 'Valid email required' });
        }

        // Check if user already exists
        db.get(
            `SELECT id FROM users WHERE email = ?`,
            [email],
            (err, existingUser) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (existingUser) {
                    return res.status(400).json({ message: 'User with this email already exists' });
                }

                // Check if invitation already exists
                db.get(
                    `SELECT invite_id FROM invitations WHERE email = ?`,
                    [email],
                    (err, existingInvite) => {
                        if (err) {
                            console.error('Database error:', err.message);
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
                            `INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)`,
                            [inviteId, email, invitedBy],
                            (err) => {
                                if (err) {
                                    console.error('Database error:', err.message);
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
            }
        );
    } catch (error) {
        console.error('Invite error:', error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create user endpoint
app.post('/create_user', (req, res) => {
    try {
        const { invite_id, user_name, password } = req.body;

        if (!invite_id || !user_name || !password) {
            return res.status(400).json({ message: 'All fields required' });
        }

        if (user_name.length < 3 || user_name.length > 50) {
            return res.status(400).json({ message: 'Username must be between 3 and 50 characters' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        // Verify invitation
        db.get(
            `SELECT email, used FROM invitations WHERE invite_id = ?`,
            [invite_id],
            (err, invitation) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!invitation) {
                    return res.status(401).json({ message: 'Invalid invite_id' });
                }

                if (invitation.used) {
                    return res.status(401).json({ message: 'Invalid invite_id' });
                }

                // Check if username already exists
                db.get(
                    `SELECT id FROM users WHERE username = ?`,
                    [user_name],
                    (err, existingUser) => {
                        if (err) {
                            console.error('Database error:', err.message);
                            return res.status(500).json({ message: 'Internal server error' });
                        }

                        if (existingUser) {
                            return res.status(400).json({ 
                                message: 'Username already exists. Try providing different username.' 
                            });
                        }

                        // Hash password and create user
                        bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
                            if (err) {
                                console.error('Bcrypt error:', err.message);
                                return res.status(500).json({ message: 'Internal server error' });
                            }

                            db.run(
                                `INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)`,
                                [user_name, hash, invitation.email],
                                (err) => {
                                    if (err) {
                                        console.error('Database error:', err.message);
                                        return res.status(500).json({ message: 'Internal server error' });
                                    }

                                    // Mark invitation as used
                                    db.run(
                                        `UPDATE invitations SET used = 1 WHERE invite_id = ?`,
                                        [invite_id],
                                        (err) => {
                                            if (err) {
                                                console.error('Database error:', err.message);
                                                return res.status(500).json({ message: 'Internal server error' });
                                            }

                                            res.json({ message: 'User created successfully' });
                                        }
                                    );
                                }
                            );
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Create user error:', error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});