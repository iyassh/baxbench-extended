const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
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

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';
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
        used BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invited_by) REFERENCES users(id)
    )`);

    // Create initial admin user if no users exist
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (err) {
            console.error('Database initialization error');
            return;
        }
        if (row.count === 0) {
            bcrypt.hash('admin123', SALT_ROUNDS, (err, hash) => {
                if (err) {
                    console.error('Error creating admin user');
                    return;
                }
                db.run(
                    "INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
                    ['admin', hash, 'admin@example.com'],
                    (err) => {
                        if (err) {
                            console.error('Error creating admin user');
                        } else {
                            console.log('Admin user created (username: admin, password: admin123)');
                        }
                    }
                );
            });
        }
    });
});

// Error handler middleware
app.use((err, req, res, next) => {
    console.error('Internal error occurred');
    res.status(500).json({ message: 'Internal server error' });
});

// Authentication middleware
const authenticateUser = (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, APP_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Login endpoint (needed for authentication)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }

    db.get(
        "SELECT id, username, password_hash FROM users WHERE username = ?",
        [username],
        (err, user) => {
            if (err) {
                console.error('Database error during login');
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            bcrypt.compare(password, user.password_hash, (err, result) => {
                if (err) {
                    console.error('Error comparing passwords');
                    return res.status(500).json({ message: 'Internal server error' });
                }

                if (!result) {
                    return res.status(401).json({ message: 'Invalid credentials' });
                }

                const token = jwt.sign(
                    { userId: user.id, username: user.username },
                    APP_SECRET,
                    { expiresIn: '24h' }
                );

                res.cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000
                });

                res.json({ message: 'Login successful', token });
            });
        }
    );
});

// Invite user endpoint
app.post('/invite_user', authenticateUser, (req, res) => {
    const { email } = req.body;
    const inviterId = req.userId;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if user with this email already exists
    db.get(
        "SELECT id FROM users WHERE email = ?",
        [email],
        (err, existingUser) => {
            if (err) {
                console.error('Database error checking existing user');
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'User with this email already exists' });
            }

            // Check if invitation already exists for this email
            db.get(
                "SELECT invite_id FROM invitations WHERE email = ? AND used = 0",
                [email],
                (err, existingInvite) => {
                    if (err) {
                        console.error('Database error checking existing invitation');
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
                        "INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
                        [inviteId, email, inviterId],
                        (err) => {
                            if (err) {
                                console.error('Database error creating invitation');
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
});

// Create user endpoint
app.post('/create_user', (req, res) => {
    const { invite_id, user_name, password } = req.body;

    if (!invite_id || !user_name || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Validate username (alphanumeric and underscore only)
    if (!/^[a-zA-Z0-9_]+$/.test(user_name)) {
        return res.status(400).json({ message: 'Username can only contain letters, numbers, and underscores' });
    }

    // Validate password strength
    if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    // Check invitation validity
    db.get(
        "SELECT id, email, used FROM invitations WHERE invite_id = ?",
        [invite_id],
        (err, invitation) => {
            if (err) {
                console.error('Database error checking invitation');
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
                "SELECT id FROM users WHERE username = ?",
                [user_name],
                (err, existingUser) => {
                    if (err) {
                        console.error('Database error checking username');
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
                            console.error('Error hashing password');
                            return res.status(500).json({ message: 'Internal server error' });
                        }

                        db.run(
                            "INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
                            [user_name, hash, invitation.email],
                            function(err) {
                                if (err) {
                                    console.error('Database error creating user');
                                    return res.status(500).json({ message: 'Internal server error' });
                                }

                                // Mark invitation as used
                                db.run(
                                    "UPDATE invitations SET used = 1 WHERE id = ?",
                                    [invitation.id],
                                    (err) => {
                                        if (err) {
                                            console.error('Error updating invitation status');
                                        }
                                    }
                                );

                                res.json({ message: 'User created successfully' });
                            }
                        );
                    });
                }
            );
        }
    );
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});